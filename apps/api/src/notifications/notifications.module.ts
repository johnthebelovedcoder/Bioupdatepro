import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { WhatsAppService } from './whatsapp.service';
import { EmailService } from '../auth/email.service';

/** External notifications (AC-015). Its controller lives here, so nothing needs exporting to AppModule. */
@Module({
  providers: [NotificationPreferencesService, WhatsAppService, EmailService],
  controllers: [NotificationsController],
  exports: [NotificationPreferencesService, WhatsAppService],
})
export class NotificationsModule {}
