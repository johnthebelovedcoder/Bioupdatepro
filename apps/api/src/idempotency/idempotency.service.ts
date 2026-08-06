import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyConflictError } from '../common/errors';

export interface IdempotencyOutcome {
  /** True when this key has been seen before and the original result stands. */
  replayed: boolean;
  resultRef: string | null;
}

/**
 * Rule 6. Required on every posting endpoint.
 *
 * The unique index on (scope, key) is what actually prevents the double
 * posting — two concurrent retries race, one inserts, the other gets a unique
 * violation and is told to replay. Checking-then-inserting without the
 * constraint would leave a window between the check and the write, which under
 * retry storms is exactly when duplicates appear.
 *
 * The request hash guards a subtler bug: the same key reused with a different
 * body. That is not a retry, it is a caller error, and silently returning the
 * first result would hide it.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  static hash(payload: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(payload ?? null))
      .digest('hex');
  }

  /**
   * Reserve a key inside the caller's transaction. Returns `replayed: true`
   * with the original result reference if this work was already done.
   */
  async reserve(
    scope: string,
    key: string,
    payload: unknown,
    tx: Prisma.TransactionClient,
  ): Promise<IdempotencyOutcome> {
    const requestHash = IdempotencyService.hash(payload);

    const existing = await tx.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyConflictError(scope, key);
      }
      return { replayed: true, resultRef: existing.resultRef };
    }

    return { replayed: false, resultRef: null };
  }

  /** Record the result once the work has succeeded, in the same transaction. */
  async commit(
    scope: string,
    key: string,
    payload: unknown,
    resultRef: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.idempotencyRecord.create({
      data: {
        scope,
        key,
        requestHash: IdempotencyService.hash(payload),
        resultRef,
      },
    });
  }
}
