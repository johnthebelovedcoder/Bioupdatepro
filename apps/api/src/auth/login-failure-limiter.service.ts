import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const MAX_FAILED_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000;
const CLEANUP_INTERVAL_MS = 60 * 60_000;

interface FailureWindow {
  failure_count: number;
  window_started_at: Date;
}

/**
 * Brute-force protection shared across API instances and restarts.
 *
 * Only a one-way digest of a normalized email is persisted. Failed attempts
 * live for one fixed 15-minute window; a successful login deletes the row.
 * PostgreSQL's upsert makes simultaneous attempts count atomically.
 */
@Injectable()
export class LoginFailureLimiter {
  private lastCleanupAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async retryAfter(email: string): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<FailureWindow[]>(
      `SELECT failure_count, window_started_at
       FROM login_failure_windows
       WHERE email_hash = $1`,
      this.key(email),
    );
    const window = rows[0];
    if (!window || window.failure_count < MAX_FAILED_ATTEMPTS) return 0;

    const remainingMs = window.window_started_at.getTime() + WINDOW_MS - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  async recordFailure(email: string): Promise<void> {
    const now = new Date();
    await this.prisma.$queryRawUnsafe(
      `INSERT INTO login_failure_windows (email_hash, failure_count, window_started_at, updated_at)
       VALUES ($1, 1, $2, $2)
       ON CONFLICT (email_hash) DO UPDATE SET
         failure_count = CASE
           WHEN login_failure_windows.window_started_at <= $2::timestamptz - INTERVAL '15 minutes' THEN 1
           ELSE LEAST(login_failure_windows.failure_count + 1, $3)
         END,
         window_started_at = CASE
           WHEN login_failure_windows.window_started_at <= $2::timestamptz - INTERVAL '15 minutes' THEN $2
           ELSE login_failure_windows.window_started_at
         END,
         updated_at = $2
       RETURNING failure_count`,
      this.key(email),
      now,
      MAX_FAILED_ATTEMPTS,
    );

    // Keep the table bounded even when bots try many made-up email addresses.
    // Each API instance does this at most hourly, outside the request path's
    // normal read. Expired rows are harmless and cannot hold a login locked.
    if (Date.now() - this.lastCleanupAt >= CLEANUP_INTERVAL_MS) {
      this.lastCleanupAt = Date.now();
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM login_failure_windows
         WHERE window_started_at < NOW() - INTERVAL '1 day'`,
      );
    }
  }

  async clear(email: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      'DELETE FROM login_failure_windows WHERE email_hash = $1',
      this.key(email),
    );
  }

  private key(email: string): string {
    const normalized = email.trim().toLowerCase();
    return createHash('sha256').update(normalized).digest('hex');
  }
}
