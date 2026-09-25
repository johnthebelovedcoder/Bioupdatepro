import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationChannel, NotificationStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../auth/email.service';

/** How often queued emails are sent. Approvals are not urgent to the second. */
const EVERY_MS = 2 * 60 * 1000;
/** A bound per pass, so one pass never runs long. */
const BATCH = 50;

/**
 * Delivers the EMAIL rows NotificationService queues — the outbox's other half.
 *
 * NotificationService writes every approval notification in the same
 * transaction as the approval, and left the email copies PENDING because
 * there was no dispatcher. Six documents then waited twelve days with nobody
 * told (2026-09-25). This sends them through the same provider invitations
 * and password resets use (Resend: RESEND_API_KEY and RESEND_FROM_EMAIL).
 *
 * With no provider configured it does nothing and the rows stay PENDING —
 * visibly unsent, never marked sent. A refused send is marked FAILED with the
 * reason, not retried forever.
 */
@Injectable()
export class NotificationDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDispatcherService.name);
  private readonly email = new EmailService();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // Not in tests, and not where nothing could be sent anyway.
    if (process.env.NODE_ENV === 'test' || process.env.VITEST || !this.email.isConfigured()) return;
    this.timer = setInterval(() => void this.dispatch(), EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over queued emails. Returns how many were sent and how many failed. */
  async dispatch(): Promise<{ sent: number; failed: number }> {
    if (this.running || !this.email.isConfigured()) return { sent: 0, failed: 0 };
    this.running = true;
    let sent = 0;
    let failed = 0;
    try {
      const queued = await this.prisma.workflowNotification.findMany({
        where: { channel: NotificationChannel.EMAIL, status: NotificationStatus.PENDING },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
        include: {
          recipient: { select: { email: true, fullName: true, active: true } },
          transaction: { select: { status: true } },
        },
      });
      const stale = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const row of queued) {
        // Queued long before anything could send it, or about a document that
        // has since been decided: telling someone now would only confuse them.
        if (!['SUBMITTED', 'UNDER_REVIEW'].includes(row.transaction.status)) {
          await this.mark(row.id, false, 'Not sent: the document is no longer waiting.');
          failed += 1;
          continue;
        }
        if (row.createdAt.getTime() < stale) {
          await this.mark(row.id, false, 'Not sent: queued more than a week ago.');
          failed += 1;
          continue;
        }
        if (!row.recipient.active || !row.recipient.email) {
          await this.mark(row.id, false, 'Recipient has no active email address.');
          failed += 1;
          continue;
        }
        const ok = await this.email.send({
          to: row.recipient.email,
          subject: row.subject,
          html: render(row.recipient.fullName, row.body),
        });
        await this.mark(row.id, ok, ok ? null : 'The email provider refused it.');
        if (ok) sent += 1;
        else failed += 1;
      }
    } catch (error) {
      this.logger.warn(`Notification dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
    if (sent + failed > 0) this.logger.log(`Approval emails: ${sent} sent, ${failed} failed.`);
    return { sent, failed };
  }

  private async mark(id: string, ok: boolean, reason: string | null): Promise<void> {
    await this.prisma.workflowNotification.update({
      where: { id },
      data: ok
        ? { status: NotificationStatus.SENT, sentAt: new Date() }
        : { status: NotificationStatus.FAILED, failureReason: reason },
    });
  }
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render(name: string, body: string): string {
  const site = process.env.WEB_ORIGIN?.split(',')[0]?.trim() || 'https://bioassetpro-web.onrender.com';
  return (
    `<p>Hello ${escape(name)},</p>` +
    `<p>${escape(body)}</p>` +
    `<p><a href="${site}/approvals">Open your approvals</a></p>` +
    `<p style="color:#777;font-size:12px">BioAssetPro — you are receiving this because you can approve this document.</p>`
  );
}
