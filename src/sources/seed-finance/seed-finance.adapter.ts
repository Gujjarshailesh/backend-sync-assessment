import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  CanonicalEnvelope,
  CanonicalTransaction,
} from '../../common/interfaces/canonical-entities.interface';
import {
  CursorKind,
  EntityType,
  FetchResult,
  PersistOutcome,
  SourceAdapter,
} from '../../common/interfaces/source-adapter.interface';
import { StaleCursorError } from '../../common/errors/domain-errors';
import {
  SEED_FINANCE_RECORDS,
  SeedFinanceRecord,
} from './seed-finance.fixture';

export const SEED_FINANCE_SOURCE = 'seed_finance';

/**
 * Adapter over a static in-memory fixture rather than a live API - but it
 * implements the exact same SourceAdapter contract as the real providers,
 * including a genuine (if synthetic) stale-cursor path: an unparseable
 * cursor throws StaleCursorError just like a rejected real API cursor would,
 * so the fallback-to-full behavior is demonstrable for all four adapters
 * the same way.
 */
@Injectable()
export class SeedFinanceAdapter implements SourceAdapter<CanonicalTransaction> {
  readonly sourceName = SEED_FINANCE_SOURCE;
  readonly entityType: EntityType = 'transaction';
  readonly cursorKind: CursorKind = 'timestamp';

  constructor(private readonly prisma: PrismaService) {}

  fetchFull(): Promise<FetchResult<CanonicalTransaction>> {
    const envelopes = SEED_FINANCE_RECORDS.map(toEnvelope);
    return Promise.resolve({
      envelopes,
      nextCursor: this.nextCursorFrom(SEED_FINANCE_RECORDS),
    });
  }

  fetchIncremental(cursor: string): Promise<FetchResult<CanonicalTransaction>> {
    const since = new Date(cursor);
    if (Number.isNaN(since.getTime())) {
      throw new StaleCursorError(
        SEED_FINANCE_SOURCE,
        `cursor "${cursor}" is not a valid ISO date`,
      );
    }

    const changed = SEED_FINANCE_RECORDS.filter(
      (record) => new Date(record.updatedAt).getTime() > since.getTime(),
    );
    const envelopes = changed.map(toEnvelope);
    const nextCursor =
      changed.length > 0 ? this.nextCursorFrom(changed) : cursor;
    return Promise.resolve({ envelopes, nextCursor });
  }

  private nextCursorFrom(records: SeedFinanceRecord[]): string {
    const maxMs = Math.max(
      ...records.map((r) => new Date(r.updatedAt).getTime()),
    );
    return new Date(maxMs).toISOString();
  }

  async persist(
    envelope: CanonicalEnvelope<CanonicalTransaction>,
  ): Promise<PersistOutcome> {
    const where = {
      source_externalId: {
        source: envelope.source,
        externalId: envelope.externalId,
      },
    };
    const existing = await this.prisma.transaction.findUnique({
      where,
      select: { id: true },
    });

    const fields = {
      customerRef: envelope.data.customerRef,
      amount: envelope.data.amount,
      currency: envelope.data.currency,
      rawStatus: envelope.data.rawStatus,
      occurredAt: envelope.data.occurredAt,
      sourceUpdatedAt: envelope.sourceUpdatedAt,
      rawPayload: envelope.raw as Prisma.InputJsonValue,
      syncedAt: new Date(),
    };

    await this.prisma.transaction.upsert({
      where,
      create: {
        source: envelope.source,
        externalId: envelope.externalId,
        ...fields,
      },
      update: fields,
    });

    return {
      action: existing ? 'updated' : 'created',
      externalId: envelope.externalId,
    };
  }
}

function toEnvelope(
  record: SeedFinanceRecord,
): CanonicalEnvelope<CanonicalTransaction> {
  return {
    source: SEED_FINANCE_SOURCE,
    externalId: record.id,
    sourceUpdatedAt: new Date(record.updatedAt),
    raw: record,
    data: {
      customerRef: record.customerRef,
      amount: record.amount,
      currency: record.currency,
      rawStatus: record.status,
      occurredAt: new Date(record.occurredAt),
    },
  };
}
