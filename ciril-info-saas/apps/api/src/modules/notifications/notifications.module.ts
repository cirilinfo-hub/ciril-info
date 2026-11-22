import { Module } from '@nestjs/common';
import { AdminNotificationsService } from './admin-notifications.service.js';
import { AdminNotificationsController, NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { StaffNotifier } from './staff-notifier.service.js';

@Module({
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [NotificationsService, AdminNotificationsService, StaffNotifier],
  exports: [StaffNotifier],
})
export class NotificationsModule {}
