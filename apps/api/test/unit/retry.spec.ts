import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@bioassetpro/database';
import { withDbRetry } from '../../src/prisma/retry';

/**
 * The whole point of `withDbRetry` is absorbing a cold Neon/Render Postgres
 * compute waking up mid-request — see the file's own doc comment for why
 * `AuthService.resolve()` needed this. These tests run with fake timers so
 * the ~11s worst-case backoff does not actually slow the suite down.
 */
function connectionError(code: 'P1001' | 'P1002' | 'P1017'): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Can’t reach database server', {
    code,
    clientVersion: 'test',
  });
}

describe('withDbRetry', () => {
  it('returns the result immediately when the first attempt succeeds', async () => {
    const run = vi.fn().mockResolvedValue('ok');
    await expect(withDbRetry(run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries a transient connection error and returns once it succeeds', async () => {
    vi.useFakeTimers();
    try {
      const run = vi
        .fn()
        .mockRejectedValueOnce(connectionError('P1001'))
        .mockRejectedValueOnce(connectionError('P1017'))
        .mockResolvedValue('recovered');

      const promise = withDbRetry(run);
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe('recovered');
      expect(run).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up and throws the real error once every attempt is exhausted', async () => {
    vi.useFakeTimers();
    try {
      const error = connectionError('P1002');
      const run = vi.fn().mockRejectedValue(error);

      const promise = withDbRetry(run, 4);
      // Attach a rejection handler before advancing timers, so vitest never
      // sees an unhandled rejection while the fake clock is running.
      const assertion = expect(promise).rejects.toBe(error);
      await vi.runAllTimersAsync();
      await assertion;

      expect(run).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a real answer that just happens to be a rejection — e.g. wrong password', async () => {
    const notTransient = new Error('Email or password is incorrect.');
    const run = vi.fn().mockRejectedValue(notTransient);

    await expect(withDbRetry(run)).rejects.toBe(notTransient);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
