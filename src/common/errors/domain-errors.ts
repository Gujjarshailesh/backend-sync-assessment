/**
 * Thrown by an adapter's fetchIncremental() when the provider signals the
 * cursor is no longer usable (Google's 410 fullSyncRequired, an unresolvable
 * Stripe event id, a rejected HubSpot search cursor, ...). The sync runner
 * catches this specifically and falls back to fetchFull() in the same pass -
 * every other error propagates and fails the source for this run.
 */
export class StaleCursorError extends Error {
  constructor(
    public readonly source: string,
    cause?: unknown,
  ) {
    super(
      `Cursor for source "${source}" is stale or invalid; a full re-fetch is required.`,
    );
    this.name = 'StaleCursorError';
    this.cause = cause;
  }
}

/** The provider is down, rejected auth, or returned an unrecoverable error. */
export class SourceUnavailableError extends Error {
  constructor(
    public readonly source: string,
    cause?: unknown,
  ) {
    super(`Source "${source}" is unavailable: ${describeCause(cause)}`);
    this.name = 'SourceUnavailableError';
    this.cause = cause;
  }
}

/** A record from the source couldn't be translated into the canonical shape. */
export class MappingError extends Error {
  constructor(
    public readonly source: string,
    message: string,
    cause?: unknown,
  ) {
    super(`Mapping error for source "${source}": ${message}`);
    this.name = 'MappingError';
    this.cause = cause;
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return 'unknown error';
}
