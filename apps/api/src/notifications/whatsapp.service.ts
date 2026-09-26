import { Injectable, Logger } from '@nestjs/common';

/**
 * Sending WhatsApp messages, through Meta's WhatsApp Cloud API.
 *
 * A message a business starts must use a template Meta has approved, so this
 * sends templates only: one for notices (its single body parameter is the
 * notice text) and one for verification codes (an authentication template).
 *
 * Optional and gated, like email: without WHATSAPP_TOKEN,
 * WHATSAPP_PHONE_NUMBER_ID and the two template names it does nothing, and
 * the rows it would have sent stay visibly unsent.
 *
 *   WHATSAPP_TOKEN              a system-user access token
 *   WHATSAPP_PHONE_NUMBER_ID    the sending number's id in WhatsApp Manager
 *   WHATSAPP_NOTICE_TEMPLATE    e.g. approval_notice (body: {{1}})
 *   WHATSAPP_CODE_TEMPLATE      e.g. verification_code (authentication)
 *   WHATSAPP_TEMPLATE_LANGUAGE  optional, default en
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  isConfigured(): boolean {
    return Boolean(
      process.env.WHATSAPP_TOKEN &&
        process.env.WHATSAPP_PHONE_NUMBER_ID &&
        process.env.WHATSAPP_NOTICE_TEMPLATE &&
        process.env.WHATSAPP_CODE_TEMPLATE,
    );
  }

  /** A notice. True only if Meta accepted it; never throws. */
  async sendNotice(to: string, text: string): Promise<boolean> {
    return this.send(to, {
      name: process.env.WHATSAPP_NOTICE_TEMPLATE!,
      components: [{ type: 'body', parameters: [{ type: 'text', text: text.slice(0, 1000) }] }],
    });
  }

  /** A verification code, through the authentication template (body and copy-code button). */
  async sendCode(to: string, code: string): Promise<boolean> {
    return this.send(to, {
      name: process.env.WHATSAPP_CODE_TEMPLATE!,
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    });
  }

  private async send(to: string, template: { name: string; components: unknown[] }): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const response = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.replace(/^\+/, ''),
          type: 'template',
          template: { name: template.name, language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en' }, components: template.components },
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        // The number is kept out of the log beyond its last four digits.
        this.logger.warn(`WhatsApp refused a message to …${to.slice(-4)}: ${response.status} ${body.slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`Could not reach WhatsApp for …${to.slice(-4)}: ${String(error)}`);
      return false;
    }
  }
}
