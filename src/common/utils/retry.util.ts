export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  /** Return false for errors that should fail immediately (e.g. 4xx auth errors). */
  isRetryable?: (error: unknown) => boolean;
}

/**
 * Exponential backoff with jitter, for transient failures only (429/5xx/
 * network timeouts). Non-retryable errors (auth, validation, stale-cursor
 * signals) should be identified via `isRetryable` and are re-thrown
 * immediately - retrying those would just delay a failure that retrying
 * can't fix.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { retries = 3, baseDelayMs = 300, isRetryable = () => true } = options;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > retries || !isRetryable(error)) {
        throw error;
      }
      const delay =
        baseDelayMs * 2 ** (attempt - 1) + Math.random() * baseDelayMs;
      await sleep(delay);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
