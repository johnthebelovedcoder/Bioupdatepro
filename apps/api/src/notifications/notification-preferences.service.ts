import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { AuditAction } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { WorkflowActor } from '../workflow/workflow.types';
import { ALL_EVENTS, normaliseNumber, policyFor } from './notification-rules';
import { WhatsAppService } from './whatsapp.service';

const POLICY_ROLES = ['ADMINISTRATOR', 'CFO'];
const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;

const hashCode = (userId: string, code: string) => createHash('sha256').update(`${userId}:${code}`).digest('hex');

/**
 * External notifications (AC-015): which events a company sends by email and
 * WhatsApp, and each user's own WhatsApp number — verified by a code sent to
 * it — and their consent, given and withdrawn by them alone.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  async mine(companyId: string, userId: string) {
    const [policy, contact] = await Promise.all([
      policyFor(this.prisma, companyId),
      this.prisma.notificationContact.findFirst({ where: { companyId, userId } }),
    ]);
    const consented = Boolean(contact?.consentedAt && (!contact.withdrawnAt || contact.withdrawnAt < contact.consentedAt));
    return {
      whatsappAvailable: this.whatsapp.isConfigured(),
      whatsappNumber: contact?.whatsappNumber ?? null,
      verified: Boolean(contact?.whatsappVerifiedAt),
      codePending: Boolean(contact?.codeHash && contact.codeExpiresAt && contact.codeExpiresAt > new Date()),
      consented,
      consentedAt: consented ? contact!.consentedAt!.toISOString() : null,
      emailEvents: policy.emailEvents,
      whatsappEvents: policy.whatsappEvents,
    };
  }

  /**
   * Set (or change) my WhatsApp number and send a code to it. A new number is
   * unverified and carries no consent: both belonged to the old one.
   */
  async setNumber(params: { companyId: string; userId: string; number: string }) {
    const number = normaliseNumber(params.number ?? '');
    if (!number) throw new BadRequestException('Give a mobile number, e.g. 0803 123 4567 or +234 803 123 4567.');
    if (!this.whatsapp.isConfigured()) throw new BadRequestException('WhatsApp is not set up for this farm yet.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const existing = await this.prisma.notificationContact.findFirst({ where: { companyId: params.companyId, userId: params.userId } });
    const changed = existing?.whatsappNumber !== number;
    const data = {
      whatsappNumber: number,
      codeHash: hashCode(params.userId, code),
      codeExpiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
      codeAttempts: 0,
      ...(changed ? { whatsappVerifiedAt: null, consentedAt: null, withdrawnAt: null } : {}),
    };
    if (existing) await this.prisma.notificationContact.update({ where: { id: existing.id }, data });
    else await this.prisma.notificationContact.create({ data: { ...data, companyId: params.companyId, userId: params.userId } });
    const sent = await this.whatsapp.sendCode(number, code);
    if (!sent) throw new BadRequestException('WhatsApp would not deliver a code to that number. Check it is on WhatsApp and try again.');
    await this.audit.write({
      transactionId: params.userId,
      module: 'notifications',
      entityType: 'NotificationContact',
      entityId: params.userId,
      status: 'UNVERIFIED',
      action: AuditAction.UPDATE,
      userId: params.userId,
      comments: `WhatsApp number set to …${number.slice(-4)}; verification code sent.`,
    });
    return { sentTo: `…${number.slice(-4)}`, expiresInMinutes: CODE_MINUTES };
  }

  /** Enter the code sent to my number. Five tries, ten minutes. */
  async verify(params: { companyId: string; userId: string; code: string }) {
    const contact = await this.prisma.notificationContact.findFirst({ where: { companyId: params.companyId, userId: params.userId } });
    if (!contact?.codeHash || !contact.codeExpiresAt) throw new BadRequestException('Ask for a code first.');
    if (contact.codeExpiresAt < new Date()) throw new BadRequestException('That code has expired. Ask for a new one.');
    if (contact.codeAttempts >= MAX_ATTEMPTS) throw new BadRequestException('Too many wrong codes. Ask for a new one.');
    const given = Buffer.from(hashCode(params.userId, String(params.code ?? '').trim()));
    const expected = Buffer.from(contact.codeHash);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      await this.prisma.notificationContact.update({ where: { id: contact.id }, data: { codeAttempts: { increment: 1 } } });
      throw new BadRequestException('That code is not right.');
    }
    await this.prisma.notificationContact.update({
      where: { id: contact.id },
      data: { whatsappVerifiedAt: new Date(), codeHash: null, codeExpiresAt: null, codeAttempts: 0 },
    });
    await this.audit.write({
      transactionId: params.userId,
      module: 'notifications',
      entityType: 'NotificationContact',
      entityId: params.userId,
      status: 'VERIFIED',
      action: AuditAction.UPDATE,
      userId: params.userId,
      comments: `WhatsApp number …${contact.whatsappNumber?.slice(-4)} verified.`,
    });
    return this.mine(params.companyId, params.userId);
  }

  /** Give or withdraw my consent to WhatsApp messages. Only I can, and only for a verified number. */
  async setConsent(params: { companyId: string; userId: string; consent: boolean }) {
    const contact = await this.prisma.notificationContact.findFirst({ where: { companyId: params.companyId, userId: params.userId } });
    if (params.consent && !contact?.whatsappVerifiedAt) throw new BadRequestException('Verify your WhatsApp number before agreeing to messages on it.');
    if (!contact) return this.mine(params.companyId, params.userId);
    await this.prisma.notificationContact.update({
      where: { id: contact.id },
      data: params.consent ? { consentedAt: new Date(), withdrawnAt: null } : { withdrawnAt: new Date() },
    });
    await this.audit.write({
      transactionId: params.userId,
      module: 'notifications',
      entityType: 'NotificationContact',
      entityId: params.userId,
      status: params.consent ? 'CONSENTED' : 'WITHDRAWN',
      action: AuditAction.UPDATE,
      userId: params.userId,
      comments: params.consent ? 'Agreed to WhatsApp messages.' : 'Withdrew consent to WhatsApp messages.',
    });
    return this.mine(params.companyId, params.userId);
  }

  async policy(companyId: string) {
    const policy = await policyFor(this.prisma, companyId);
    return { events: ALL_EVENTS, ...policy, whatsappAvailable: this.whatsapp.isConfigured() };
  }

  /** Approve which events go out by email and by WhatsApp (AC-015 "approved event"). */
  async setPolicy(params: { companyId: string; emailEvents: string[]; whatsappEvents: string[]; actor: WorkflowActor }) {
    if (!params.actor.roles.some((r) => POLICY_ROLES.includes(r))) throw new ForbiddenException('An administrator or the CFO approves notification events.');
    const known = new Set<string>(ALL_EVENTS);
    const clean = (events: string[]) => [...new Set((events ?? []).filter((e) => known.has(e)))];
    const emailEvents = clean(params.emailEvents);
    const whatsappEvents = clean(params.whatsappEvents);
    await this.prisma.notificationPolicy.upsert({
      where: { companyId: params.companyId },
      create: { companyId: params.companyId, emailEvents, whatsappEvents, updatedById: params.actor.userId },
      update: { emailEvents, whatsappEvents, updatedById: params.actor.userId },
    });
    await this.audit.write({
      transactionId: params.companyId,
      module: 'notifications',
      entityType: 'NotificationPolicy',
      entityId: params.companyId,
      status: 'ACTIVE',
      action: AuditAction.CONFIG_CHANGE,
      userId: params.actor.userId,
      comments: `Email: ${emailEvents.join(', ') || 'none'}. WhatsApp: ${whatsappEvents.join(', ') || 'none'}.`,
    });
    return this.policy(params.companyId);
  }
}
