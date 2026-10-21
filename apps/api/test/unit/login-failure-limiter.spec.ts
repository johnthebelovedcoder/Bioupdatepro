import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginFailureLimiter } from '../../src/auth/login-failure-limiter.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

interface Row {
  failure_count: number;
  window_started_at: Date;
}

function makeLimiter() {
  const rows = new Map<string, Row>();
  const db = {
    async $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T> {
      const key = String(values[0]);
      if (query.includes('SELECT failure_count')) {
        const row = rows.get(key);
        return (row ? [row] : []) as T;
      }
      const now = values[1] as Date;
      const maxAttempts = Number(values[2]);
      const current = rows.get(key);
      const expired = current && current.window_started_at.getTime() <= now.getTime() - 15 * 60_000;
      rows.set(key, {
        failure_count: current && !expired ? Math.min(current.failure_count + 1, maxAttempts) : 1,
        window_started_at: current && !expired ? current.window_started_at : now,
      });
      return [] as T;
    },
    async $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> {
      if (query.includes('WHERE email_hash = $1')) return Number(rows.delete(String(values[0])));
      const cutoff = Date.now() - 24 * 60 * 60_000;
      let removed = 0;
      for (const [key, row] of rows) {
        if (row.window_started_at.getTime() < cutoff) {
          rows.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
  };
  return { limiter: new LoginFailureLimiter(db as unknown as PrismaService), rows };
}

describe('LoginFailureLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks after ten failed passwords and releases the account after fifteen minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T09:00:00Z'));
    const { limiter } = makeLimiter();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(await limiter.retryAfter('worker@example.com')).toBe(0);
      await limiter.recordFailure('worker@example.com');
    }

    expect(await limiter.retryAfter('worker@example.com')).toBe(900);
    expect(await limiter.retryAfter('another@example.com')).toBe(0);

    vi.advanceTimersByTime(15 * 60_000);
    expect(await limiter.retryAfter('worker@example.com')).toBe(0);
  });

  it('normalizes the email and clears failures after a successful login', async () => {
    const { limiter, rows } = makeLimiter();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await limiter.recordFailure(' Worker@Example.com ');
    }

    expect(await limiter.retryAfter('worker@example.com')).toBeGreaterThan(0);
    expect(rows.size).toBe(1);
    await limiter.clear('WORKER@example.com');
    expect(await limiter.retryAfter('worker@example.com')).toBe(0);
    expect(rows.size).toBe(0);
  });

  it('does not extend the lockout window when further failures arrive', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T09:00:00Z'));
    const { limiter } = makeLimiter();
    for (let attempt = 0; attempt < 10; attempt += 1) await limiter.recordFailure('worker@example.com');

    vi.advanceTimersByTime(5 * 60_000);
    await limiter.recordFailure('worker@example.com');
    expect(await limiter.retryAfter('worker@example.com')).toBe(600);
  });

  it('resets expired windows on the next failed attempt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T09:00:00Z'));
    const { limiter } = makeLimiter();
    for (let attempt = 0; attempt < 10; attempt += 1) await limiter.recordFailure('worker@example.com');

    vi.advanceTimersByTime(15 * 60_000);
    expect(await limiter.retryAfter('worker@example.com')).toBe(0);
    await limiter.recordFailure('worker@example.com');
    expect(await limiter.retryAfter('worker@example.com')).toBe(0);
  });
});
