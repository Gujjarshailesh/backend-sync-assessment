import { withRetry } from './retry.util';

describe('withRetry', () => {
  it('returns the result immediately on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and eventually succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, { baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after the retry cap and throws the last error', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));

    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow(
      'always fails',
    );
    expect(fn).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
  });

  it('does not retry when isRetryable returns false', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('non-retryable'));

    await expect(
      withRetry(fn, { retries: 5, baseDelayMs: 1, isRetryable: () => false }),
    ).rejects.toThrow('non-retryable');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
