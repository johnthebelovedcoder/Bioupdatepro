import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { AnyRole, Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';
import { NotificationPreferencesService } from './notification-preferences.service';

/** External notifications (AC-015): my WhatsApp number and consent, and the company's approved events. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @AnyRole('Everyone chooses how they are told about their own approvals.')
  @Get('mine')
  async mine(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor) {
    return this.preferences.mine(companyId, actor.userId);
  }

  @AnyRole('Everyone sets their own WhatsApp number.')
  @Post('whatsapp/number')
  async setNumber(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Body() body: { number: string }) {
    return this.preferences.setNumber({ companyId, userId: actor.userId, number: String(body?.number ?? '') });
  }

  @AnyRole('Everyone verifies their own WhatsApp number.')
  @Post('whatsapp/verify')
  async verify(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Body() body: { code: string }) {
    return this.preferences.verify({ companyId, userId: actor.userId, code: String(body?.code ?? '') });
  }

  @AnyRole('Only the person themselves gives or withdraws consent.')
  @Post('whatsapp/consent')
  async consent(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Body() body: { consent: boolean }) {
    return this.preferences.setConsent({ companyId, userId: actor.userId, consent: body?.consent === true });
  }

  @AnyRole('Which events go out, and how, is not a secret.')
  @Get('policy')
  async policy(@CurrentCompany() companyId: string) {
    return this.preferences.policy(companyId);
  }

  @Roles('ADMINISTRATOR', 'CFO')
  @Post('policy')
  async setPolicy(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Body() body: { emailEvents: string[]; whatsappEvents: string[] }) {
    return this.preferences.setPolicy({ companyId, emailEvents: body?.emailEvents ?? [], whatsappEvents: body?.whatsappEvents ?? [], actor });
  }
}
