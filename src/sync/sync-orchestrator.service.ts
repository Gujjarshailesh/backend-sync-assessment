import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SyncRunStatus, TriggerType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  SOURCE_ADAPTERS,
  SourceAdapter,
} from '../common/interfaces/source-adapter.interface';
import {
  AdapterRunnerService,
  RequestedMode,
  SourceRunOutcome,
} from './adapter-runner.service';

export interface OrchestratorOptions {
  mode?: RequestedMode;
  triggerType?: TriggerType;
  /** Restrict the run to one source; omit to run every registered adapter. */
  sourceFilter?: string;
}

export interface SyncRunSummary {
  syncRunId: string;
  status: SyncRunStatus;
  sources: SourceRunOutcome[];
}

/**
 * Runs every registered adapter within one SyncRun, isolating failures
 * per source. Delegates all per-source work to AdapterRunnerService.runForSource
 * (the same method exercised standalone in Phase 3) - this class only adds
 * the "many adapters, one run, don't let one failure affect another" layer.
 */
@Injectable()
export class SyncOrchestratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AdapterRunnerService,
    @Inject(SOURCE_ADAPTERS) private readonly adapters: SourceAdapter[],
  ) {}

  async runAll(options: OrchestratorOptions = {}): Promise<SyncRunSummary> {
    const targets = this.resolveTargets(options.sourceFilter);
    const syncRun = await this.runner.createRunOrRejectIfOneInFlight(
      options.triggerType,
    );

    // Promise.allSettled, not Promise.all: runForSource already catches its
    // own errors and never rejects, but this stays the safety net so a
    // future bug in one adapter's error handling can never take the whole
    // run down with it.
    const settled = await Promise.allSettled(
      targets.map((adapter) =>
        this.runner.runForSource(adapter, syncRun.id, options.mode ?? 'auto'),
      ),
    );

    const outcomes: SourceRunOutcome[] = settled.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : {
            source: targets[index].sourceName,
            status: 'failed',
            errorMessage:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          },
    );

    const overallStatus = this.resolveOverallStatus(outcomes);
    await this.prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status: overallStatus, finishedAt: new Date() },
    });

    return { syncRunId: syncRun.id, status: overallStatus, sources: outcomes };
  }

  private resolveTargets(sourceFilter?: string): SourceAdapter[] {
    if (!sourceFilter) return this.adapters;
    const target = this.adapters.find(
      (adapter) => adapter.sourceName === sourceFilter,
    );
    if (!target) {
      throw new NotFoundException(
        `Unknown source "${sourceFilter}". Available: ${this.adapters.map((a) => a.sourceName).join(', ')}`,
      );
    }
    return [target];
  }

  private resolveOverallStatus(outcomes: SourceRunOutcome[]): SyncRunStatus {
    const anyFailed = outcomes.some((o) => o.status === 'failed');
    const anySucceeded = outcomes.some((o) => o.status === 'success');
    if (!anyFailed) return SyncRunStatus.success;
    return anySucceeded ? SyncRunStatus.partial_failure : SyncRunStatus.failed;
  }
}
