import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditContext {
  userId: string;
  ipAddress?: string | null;
  device?: string | null;
  comments?: string | null;
}

export interface AuditEvent extends AuditContext {
  transactionId: string;
  module: string;
  entityType: string;
  entityId: string;
  status: string;
  action: AuditAction;
  metadata?: Record<string, unknown>;
}

/**
 * Rule 9. Every workflow event and every posting writes one of these, and none
 * of them can ever be changed.
 *
 * `write` takes an optional transaction client so the audit record commits in
 * the SAME database transaction as the thing it describes. That matters: an
 * audit trail that can be rolled back independently of the posting is not an
 * audit trail. If the posting survives, so does its record — or neither does.
 */
@Injectable()
export class AuditService {
  /**
   * Which company each user belongs to, remembered between writes.
   *
   * This exists because of a real failure, not a guess. Resolving the company
   * with a query inside `write` put an extra round trip inside the caller's
   * transaction, and postings here already run close to Prisma's five-second
   * interactive-transaction budget — the first attempt died at 5,235ms with
   * "transaction already closed", taking the posting with it. An audit trail
   * that can fail a posting is worse than one that is a minute out of date.
   *
   * A user's company effectively never changes, and there is no path in the
   * product that changes it, so a short life is ample. It is cleared by a
   * restart, and by the TTL if that ever stops being true.
   */
  private readonly companyByUser = new Map<string, { companyId: string | null; readAt: number }>();

  private static readonly COMPANY_CACHE_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async write(
    event: AuditEvent,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const companyId = await this.companyFor(event.userId);

    await client.auditRecord.create({
      data: {
        companyId,
        transactionId: event.transactionId,
        module: event.module,
        entityType: event.entityType,
        entityId: event.entityId,
        status: event.status,
        action: event.action,
        userId: event.userId,
        ipAddress: event.ipAddress ?? null,
        device: event.device ?? null,
        comments: event.comments ?? null,
        metadata: (event.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * The acting user's company.
   *
   * Deliberately reads on `this.prisma` and never on the caller's transaction
   * client: a separate pooled connection does not queue behind the work already
   * in flight on the transaction's connection, and it cannot consume that
   * transaction's time budget. The cost is that a cache miss still adds some
   * wall time to the surrounding transaction — bounded to the first write per
   * user per minute, rather than every write.
   */
  private async companyFor(userId: string): Promise<string | null> {
    const cached = this.companyByUser.get(userId);
    if (cached && Date.now() - cached.readAt < AuditService.COMPANY_CACHE_MS) {
      return cached.companyId;
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    const companyId = actor?.companyId ?? null;
    this.companyByUser.set(userId, { companyId, readAt: Date.now() });
    return companyId;
  }

  /** Read-only. There is no update or delete counterpart, by design. */
  async findForTransaction(transactionId: string) {
    return this.prisma.auditRecord.findMany({
      where: { transactionId },
      orderBy: { occurredAt: 'asc' },
    });
  }

  async findForEntity(module: string, entityType: string, entityId: string) {
    return this.prisma.auditRecord.findMany({
      where: { module, entityType, entityId },
      orderBy: { occurredAt: 'asc' },
    });
  }
}
