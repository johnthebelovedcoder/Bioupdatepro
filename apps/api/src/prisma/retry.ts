import { Prisma } from '@bioassetpro/database';

/**
 * Retries a query that failed because the database connection itself was
 * the problem — Neon (dev) and Render's free Postgres (prod) both suspend
 * their compute after a few idle minutes and take a handful of seconds to
 * wake back up on the next connection.
 *
 * `PrismaService.onModuleInit()` already retries this same class of error,
 * but only for the ONE connection made when the process boots. Every query
 * after that — most importantly `AuthService.resolve()`, which runs on
 * every single authenticated request via `JwtStrategy` — had no retry at
 * all: the first query to land after an idle spell throws straight through
 * to the caller, and for `resolve()` that caller is Passport, which turns
 * any thrown error into a 401. A user with a perfectly valid, unexpired
 * token then sees "Your session has ended" — not because it had, but
 * because the database was cold for one query. This is the same failure
 * for a login attempt itself: `AuthService.login()`'s user lookup can hit
 * the identical cold connection and surface as "Cannot reach the API".
 *
 * Deliberately narrow: only Prisma's own "the connection itself failed"
 * codes are retried (P1001 unreachable, P1002 timed out, P1017 connection
 * closed) — never a query that ran and returned a real answer. A wrong
 * password or an unknown user must fail immediately, not after a delay
 * that makes brute-forcing slower to notice.
 */
const TRANSIENT_CODES = new Set(['P1001', 'P1002', 'P1017']);

function isTransientConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return TRANSIENT_CODES.has(error.code);
  }
  // Prisma throws this subclass, not a KnownRequestError, for a connection
  // that never opened at all — the same P1001/P1002 condition, one level up.
  return error instanceof Prisma.PrismaClientInitializationError;
}

/**
 * Same backoff shape as `PrismaService.onModuleInit()` (capped doubling),
 * sized to the same cold start it is absorbing — attempts at +0s, +1s, +3s,
 * +7s, roughly 11s of total patience before giving up and letting the real
 * error through.
 */
export async function withDbRetry<T>(run: () => Promise<T>, maxAttempts = 4): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt === maxAttempts || !isTransientConnectionError(error)) throw error;
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Unreachable — the loop above always returns or throws — but keeps the
  // function's return type honest without a non-null assertion.
  throw new Error('withDbRetry: exhausted attempts without returning or throwing.');
}
