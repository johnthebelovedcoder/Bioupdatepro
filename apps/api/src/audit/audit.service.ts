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
  constructor(private readonly prisma: PrismaService) {}

  async write(
    event: AuditEvent,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditRecord.create({
      data: {
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
