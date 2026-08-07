import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationEvent,
  NotificationStatus,
  Prisma,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificationRequest {
  transactionId: string;
  recipientIds: string[];
  event: NotificationEvent;
  subject: string;
  body: string;
  channels?: NotificationChannel[];
}

/**
 * §2 Notifications, as an outbox.
 *
 * Rows are written inside the same database transaction as the event that
 * caused them. That ordering is the point: if the approval rolls back, so do
 * its notifications, and nobody is ever told about an approval that did not
 * happen. Delivery is a separate, retryable pass over PENDING rows.
 *
 * In-app delivery is the row itself. Email and push need a provider that this
 * deployment does not yet have, so those rows are queued and left PENDING
 * rather than silently marked sent — an unsent notification should look unsent.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async queue(
    request: NotificationRequest,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const recipients = [...new Set(request.recipientIds)].filter(Boolean);
    if (recipients.length === 0) return;

    const channels = request.channels ?? [
      NotificationChannel.IN_APP,
      NotificationChannel.EMAIL,
    ];
    const client = tx ?? this.prisma;

    await client.workflowNotification.createMany({
      data: recipients.flatMap((recipientId) =>
        channels.map((channel) => ({
          transactionId: request.transactionId,
          recipientId,
          channel,
          event: request.event,
          subject: request.subject,
          body: request.body,
          // In-app is delivered by existing; anything else awaits a dispatcher.
          status:
            channel === NotificationChannel.IN_APP
              ? NotificationStatus.SENT
              : NotificationStatus.PENDING,
          sentAt: channel === NotificationChannel.IN_APP ? new Date() : null,
        })),
      ),
    });
  }

  /** A user's in-app inbox. */
  async inbox(userId: string, unreadOnly = false) {
    return this.prisma.workflowNotification.findMany({
      where: {
        recipientId: userId,
        channel: NotificationChannel.IN_APP,
        ...(unreadOnly ? { status: NotificationStatus.SENT } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        transaction: {
          select: {
            documentReference: true,
            transactionType: true,
            status: true,
          },
        },
      },
    });
  }

  /**
   * Drain queued external notifications. Wired to a scheduler in deployment;
   * called directly by tests. With no provider configured this reports what it
   * would send and leaves the rows PENDING.
   */
  async dispatchPending(limit = 100): Promise<{ dispatched: number; skipped: number }> {
    const pending = await this.prisma.workflowNotification.findMany({
      where: { status: NotificationStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    if (pending.length > 0) {
      this.logger.log(
        `${pending.length} notification(s) queued for external delivery; ` +
          `no email/push provider is configured, so they remain PENDING.`,
      );
    }

    return { dispatched: 0, skipped: pending.length };
  }
}
