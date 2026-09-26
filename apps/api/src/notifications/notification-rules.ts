import type { NotificationChannel, NotificationEvent, Prisma, PrismaClient } from '@bioassetpro/database';

type Client = Prisma.TransactionClient | PrismaClient;

export const ALL_EVENTS: NotificationEvent[] = ['SUBMISSION', 'APPROVAL', 'REJECTION', 'RETURN', 'ESCALATION', 'REMINDER', 'CANCELLATION', 'POSTING'];

/** A company with no policy row yet: email as before, nothing by WhatsApp. */
export const DEFAULT_POLICY = { emailEvents: [...ALL_EVENTS] as string[], whatsappEvents: [] as string[] };

export async function policyFor(client: Client, companyId: string) {
  const row = await client.notificationPolicy.findFirst({ where: { companyId }, select: { emailEvents: true, whatsappEvents: true } });
  return row ?? DEFAULT_POLICY;
}

/**
 * A Nigerian mobile number in E.164: 0803 123 4567, 803 123 4567,
 * 2348031234567 and +234 803 123 4567 all become +2348031234567. Another
 * country's number is accepted as given if it is already in +E.164 form.
 */
export function normaliseNumber(raw: string): string | null {
  const text = raw.replace(/[\s\-().]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(text)) return text.startsWith('+2340') ? `+234${text.slice(5)}` : text;
  const digits = text.replace(/^\+/, '');
  if (/^234[789][01]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^0[789][01]\d{8}$/.test(digits)) return `+234${digits.slice(1)}`;
  if (/^[789][01]\d{8}$/.test(digits)) return `+234${digits}`;
  return null;
}

export interface Gate {
  ok: boolean;
  /** Why a send is blocked (AC-015 "unauthorized/unverified send blocked"). */
  reason: string | null;
  /** Where it goes, when it may. */
  to: string | null;
}

/**
 * Whether one notification may go out now (AC-015): the event approved for
 * the channel by the company's policy, the recipient an active user of the
 * company, and — for WhatsApp — a verified number with consent that has not
 * been withdrawn. Checked when a message is about to be sent, not only when
 * it was queued: consent withdrawn in between still stops it.
 */
export async function gate(
  client: Client,
  params: { companyId: string; channel: NotificationChannel; event: NotificationEvent | string; recipientId: string },
): Promise<Gate> {
  const policy = await policyFor(client, params.companyId);
  const user = await client.user.findFirst({
    where: { id: params.recipientId, companyId: params.companyId },
    select: { email: true, active: true },
  });
  if (!user || !user.active) return { ok: false, reason: 'Blocked: the recipient is not an active user of this company.', to: null };

  if (params.channel === 'EMAIL') {
    if (!policy.emailEvents.includes(params.event)) return { ok: false, reason: `Blocked: ${params.event} is not an event this company sends by email.`, to: null };
    if (!user.email) return { ok: false, reason: 'Blocked: the recipient has no email address.', to: null };
    // The sign-in address: the one the person proved by accepting their invitation or setting their password.
    return { ok: true, reason: null, to: user.email };
  }

  if (params.channel === 'WHATSAPP') {
    if (!policy.whatsappEvents.includes(params.event)) return { ok: false, reason: `Blocked: ${params.event} is not an event this company sends by WhatsApp.`, to: null };
    const contact = await client.notificationContact.findFirst({
      where: { companyId: params.companyId, userId: params.recipientId },
      select: { whatsappNumber: true, whatsappVerifiedAt: true, consentedAt: true, withdrawnAt: true },
    });
    if (!contact?.whatsappNumber) return { ok: false, reason: 'Blocked: the recipient has no WhatsApp number.', to: null };
    if (!contact.whatsappVerifiedAt) return { ok: false, reason: 'Blocked: the WhatsApp number has not been verified.', to: null };
    if (!contact.consentedAt || (contact.withdrawnAt && contact.withdrawnAt >= contact.consentedAt)) {
      return { ok: false, reason: 'Blocked: the recipient has not consented to WhatsApp messages.', to: null };
    }
    return { ok: true, reason: null, to: contact.whatsappNumber };
  }

  return { ok: false, reason: `Blocked: ${params.channel} is not an external channel this service sends.`, to: null };
}
