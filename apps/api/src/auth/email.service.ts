import { Injectable, Logger } from '@nestjs/common';

/**
 * Sending real email, through Resend.
 *
 * A plain `fetch` against Resend's REST API rather than their SDK — the whole
 * surface this needs is one POST request, and a dependency for that would be
 * more weight than the call itself. Same reasoning `password.ts` gives for
 * using Node's built-in scrypt instead of a bcrypt native module.
 *
 * Optional and gated, the same way Google/Facebook sign-in are: unset
 * RESEND_API_KEY and this quietly does nothing rather than failing every
 * caller. `PasswordResetService` already has a working answer — the
 * admin-relayed link — for exactly the case where nobody has configured
 * this yet, so a missing key degrades the feature rather than breaking it.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
  }

  /** True only if Resend accepted the message for delivery — never throws, so a failed send never breaks the caller's own flow. */
  async send(params: { to: string; subject: string; html: string }): Promise<boolean> {
    if (!this.isConfigured()) return false;

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL,
          to: params.to,
          subject: params.subject,
          html: params.html,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.warn(`Resend refused a message to ${params.to}: ${response.status} ${body}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`Could not reach Resend for a message to ${params.to}: ${String(error)}`);
      return false;
    }
  }
}
