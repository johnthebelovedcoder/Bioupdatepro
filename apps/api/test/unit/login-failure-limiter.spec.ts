import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginFailureLimiter } from '../../src/auth/login-failure-limiter.service';

describe('LoginFailureLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks after ten failed passwords and releases the account after fifteen minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T09:00:00Z'));
    const limiter = new LoginFailureLimiter();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limiter.retryAfter('worker@example.com')).toBe(0);
      limiter.recordFailure('worker@example.com');
    }

    expect(limiter.retryAfter('worker@example.com')).toBe(900);
    expect(limiter.retryAfter('another@example.com')).toBe(0);

    vi.advanceTimersByTime(15 * 60_000);
    expect(limiter.retryAfter('worker@example.com')).toBe(0);
  });

  it('normalizes the email and clears failures after a successful login', () => {
    const limiter = new LoginFailureLimiter();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      limiter.recordFailure(' Worker@Example.com ');
    }

    expect(limiter.retryAfter('worker@example.com')).toBeGreaterThan(0);
    limiter.clear('WORKER@example.com');
    expect(limiter.retryAfter('worker@example.com')).toBe(0);
  });
});
