import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdminSupportService } from './admin-support.service.js';
import { AttachmentStore } from './attachment-store.js';
import { AdminSupportController, SupportController } from './support.controller.js';
import { SupportService } from './support.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService, AdminSupportService, AttachmentStore],
})
export class SupportModule {}
