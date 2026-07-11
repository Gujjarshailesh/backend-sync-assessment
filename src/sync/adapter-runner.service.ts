import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import {
  CursorType,
  Prisma,
  SyncMode,
  SyncRun,
  SyncRunSourceStatus,
  SyncRunStatus,
  TriggerType,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { SourceAdapter } from '../common/interfaces/source-adapter.interface';
import { StaleCursorError } from '../common/errors/domain-errors';
import { toAuditAction } from '../common/utils/audit-action.util';

export type RequestedMode = 'auto' | 'full' | 'incremental';

export interface SourceRunOutcome {
  source: string;
  status: 'success' | 'failed';
  mode?: 'full' | 'incremental';
  recordsFetched?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  errorMessage?: string;
}

/**
 * Runs a single adapter end to end: resolves full-vs-incremental, catches
 * StaleCursorError and falls back to a full fetch within the same pass,
 * persists every record, writes an audit log entry per record, and updates
 * sync_state/sync_run_source/sync_run.
 *
 * Deliberately split into `runStandalone` (creates its own SyncRun - used to
 * verify one provider independently, e.g. via the CLI script) and
 * `runForSource` (operates within a SyncRun the caller already created).
 * SyncOrchestratorService calls `runForSource` once per adapter inside a
 * Promise.allSettled loop over a single shared SyncRun.
 *
 * onModuleInit reconciles any sync_run left at status='running' from a
 * previous crash: a partial unique index enforces "at most one running run"
 * (see migration 20260711145348), which is exactly correct while the app is
 * up, but would otherwise permanently wedge every future trigger after a
 * hard crash - there's no other process that could ever mark that row
 * finished. Single-instance assumption: safe to declare "nothing is
 * running" the moment a fresh instance boots.
 */
@Injectable()
export class AdapterRunnerService implements OnModuleInit {
  private readonly logger = new Logger(AdapterRunnerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const { count } = await this.prisma.syncRun.updateMany({
      where: { status: SyncRunStatus.running },
      data: { status: SyncRunStatus.failed, finishedAt: new Date() },
    });
    if (count > 0) {
      this.logger.warn(
        `Reconciled ${count} sync_run row(s) stuck at 'running' from a previous crash on startup`,
      );
    }
  }

  /**
   * Relies on a partial unique index (sync_run_single_active_idx) rather
   * than a check-then-create in application code - a check-then-create is
   * not atomic and two concurrent callers can both pass the check before
   * either commits, as confirmed during verification. The database
   * rejecting the second INSERT is what actually closes the race. Shared
   * by both runStandalone and SyncOrchestratorService.runAll so there is
   * exactly one place this guard is implemented.
   */
  async createRunOrRejectIfOneInFlight(
    triggerType?: TriggerType,
  ): Promise<SyncRun> {
    try {
      return await this.prisma.syncRun.create({
        data: {
          triggerType: triggerType ?? TriggerType.manual,
          status: SyncRunStatus.running,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const inFlight = await this.prisma.syncRun.findFirst({
          where: { status: SyncRunStatus.running },
          orderBy: { startedAt: 'desc' },
        });
        throw new ConflictException(
          `A sync run${inFlight ? ` (${inFlight.id})` : ''} is already in progress. Wait for it to finish before triggering another.`,
        );
      }
      throw error;
    }
  }

  async runStandalone(
    adapter: SourceAdapter,
    mode: RequestedMode = 'auto',
  ): Promise<SourceRunOutcome> {
    const syncRun = await this.createRunOrRejectIfOneInFlight(
      TriggerType.manual,
    );

    // Wrapped in try/catch so the SyncRun always reaches a terminal status,
    // even if something throws that runForSource's own error handling
    // doesn't cover (e.g. the DB write that opens sync_run_source, which
    // happens before its try block starts). Otherwise the row is stuck at
    // 'running' forever and the concurrency guard blocks every future
    // trigger - discovered via a transient failure during test verification.
    let outcome: SourceRunOutcome;
    try {
      outcome = await this.runForSource(adapter, syncRun.id, mode);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.prisma.syncRun.update({
        where: { id: syncRun.id },
        data: { status: SyncRunStatus.failed, finishedAt: new Date() },
      });
      return { source: adapter.sourceName, status: 'failed', errorMessage };
    }

    await this.prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status:
          outcome.status === 'success'
            ? SyncRunStatus.success
            : SyncRunStatus.failed,
        finishedAt: new Date(),
      },
    });

    return outcome;
  }

  async runForSource(
    adapter: SourceAdapter,
    syncRunId: string,
    requestedMode: RequestedMode = 'auto',
  ): Promise<SourceRunOutcome> {
    const runSourceRow = await this.prisma.syncRunSource.create({
      data: {
        syncRunId,
        source: adapter.sourceName,
        mode: SyncMode.full,
        status: SyncRunSourceStatus.failed, // overwritten below; placeholder while in flight
      },
    });

    try {
      const state = await this.prisma.syncState.findUnique({
        where: { source: adapter.sourceName },
      });
      let mode: 'full' | 'incremental' =
        requestedMode === 'incremental'
          ? 'incremental'
          : requestedMode === 'full'
            ? 'full'
            : state?.cursor
              ? 'incremental'
              : 'full';

      let fetchResult;
      if (mode === 'incremental' && state?.cursor) {
        try {
          fetchResult = await adapter.fetchIncremental(state.cursor);
        } catch (error) {
          if (error instanceof StaleCursorError) {
            this.logger.warn(
              `Stale cursor for "${adapter.sourceName}" - falling back to full fetch: ${error.message}`,
            );
            mode = 'full';
            fetchResult = await adapter.fetchFull();
          } else {
            throw error;
          }
        }
      } else {
        mode = 'full';
        fetchResult = await adapter.fetchFull();
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;
      for (const envelope of fetchResult.envelopes) {
        const result = await adapter.persist(envelope);
        if (result.action === 'created') created += 1;
        else if (result.action === 'updated') updated += 1;
        else skipped += 1;

        await this.prisma.auditLog.create({
          data: {
            entityType: adapter.entityType,
            source: adapter.sourceName,
            externalId: result.externalId,
            action: toAuditAction(result.action),
            syncRunId,
          },
        });
      }

      await this.upsertSyncState(adapter, {
        cursor: fetchResult.nextCursor,
        mode,
        lastStatus: SyncRunSourceStatus.success,
      });

      await this.prisma.syncRunSource.update({
        where: { id: runSourceRow.id },
        data: {
          mode: mode === 'full' ? SyncMode.full : SyncMode.incremental,
          status: SyncRunSourceStatus.success,
          recordsFetched: fetchResult.envelopes.length,
          recordsUpserted: created + updated,
          finishedAt: new Date(),
        },
      });

      return {
        source: adapter.sourceName,
        status: 'success',
        mode,
        recordsFetched: fetchResult.envelopes.length,
        created,
        updated,
        skipped,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Sync failed for "${adapter.sourceName}": ${errorMessage}`,
      );

      await this.prisma.syncRunSource.update({
        where: { id: runSourceRow.id },
        data: {
          status: SyncRunSourceStatus.failed,
          errorMessage,
          finishedAt: new Date(),
        },
      });
      await this.upsertSyncState(adapter, {
        lastStatus: SyncRunSourceStatus.failed,
      });

      return { source: adapter.sourceName, status: 'failed', errorMessage };
    }
  }

  private async upsertSyncState(
    adapter: SourceAdapter,
    fields: {
      cursor?: string | null;
      mode?: 'full' | 'incremental';
      lastStatus: SyncRunSourceStatus;
    },
  ): Promise<void> {
    const now = new Date();
    const cursorType =
      adapter.cursorKind === 'token' ? CursorType.token : CursorType.timestamp;

    const timestampFields: Prisma.SyncStateUpdateInput = {
      lastStatus: fields.lastStatus,
      ...(fields.mode === 'full' ? { lastFullSyncAt: now } : {}),
      ...(fields.mode === 'incremental' ? { lastIncrementalSyncAt: now } : {}),
    };

    await this.prisma.syncState.upsert({
      where: { source: adapter.sourceName },
      create: {
        source: adapter.sourceName,
        cursor: fields.cursor ?? null,
        cursorType,
        lastStatus: fields.lastStatus,
        ...(fields.mode === 'full' ? { lastFullSyncAt: now } : {}),
        ...(fields.mode === 'incremental'
          ? { lastIncrementalSyncAt: now }
          : {}),
      },
      update: {
        ...(fields.cursor !== undefined
          ? { cursor: fields.cursor, cursorType }
          : {}),
        ...timestampFields,
      },
    });
  }
}
