import { CanonicalEnvelope } from './canonical-entities.interface';

/** Which normalized table a given adapter's records belong to. */
export type EntityType = 'contact' | 'calendar_event' | 'transaction';

/** How the adapter's cursor should be persisted/interpreted by the runner. */
export type CursorKind = 'timestamp' | 'token';

export interface FetchResult<T> {
  envelopes: CanonicalEnvelope<T>[];
  /**
   * The cursor to persist after this fetch. Always populated (even on a
   * full fetch) so the very next sync can go incremental. Null only if the
   * source genuinely can't produce a resumable cursor (not currently used
   * by any adapter, but kept for interface completeness).
   */
  nextCursor: string | null;
}

export type PersistAction = 'created' | 'updated' | 'skipped_duplicate';

export interface PersistOutcome {
  action: PersistAction;
  externalId: string;
}

/**
 * The contract every provider adapter implements. The sync runner (and,
 * later, the orchestrator) depends only on this interface - it never knows
 * HubSpot from Calendar from Stripe from the fabricated seed-finance source.
 */
export interface SourceAdapter<T = unknown> {
  readonly sourceName: string;
  readonly entityType: EntityType;
  readonly cursorKind: CursorKind;

  /** Fetch everything. Used on first-ever sync and as the stale-cursor fallback. */
  fetchFull(): Promise<FetchResult<T>>;

  /**
   * Fetch only what changed since `cursor`. Must throw StaleCursorError
   * (not a generic error) when the cursor is rejected/expired, so the
   * runner can fall back to fetchFull() within the same pass.
   */
  fetchIncremental(cursor: string): Promise<FetchResult<T>>;

  /**
   * Idempotently write one record to this adapter's normalized table.
   * Implementations upsert on the (source, externalId) unique constraint.
   */
  persist(envelope: CanonicalEnvelope<T>): Promise<PersistOutcome>;
}

/** DI token for the multi-provider array of registered adapters. */
export const SOURCE_ADAPTERS = 'SOURCE_ADAPTERS';
