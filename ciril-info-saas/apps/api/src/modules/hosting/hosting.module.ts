import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdminHostingService } from './admin-hosting.service.js';
import { HostingEventsHandler } from './hosting-events.handler.js';
import { HostingGateway } from './hosting-gateway.js';
import { HostingJobsService } from './hosting-jobs.service.js';
import { AdminHostingController, HostingController } from './hosting.controller.js';
import { HostingService } from './hosting.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [HostingController, AdminHostingController],
  providers: [HostingService, AdminHostingService, HostingJobsService, HostingEventsHandler, HostingGateway],
  exports: [HostingJobsService, HostingEventsHandler],
})
export class HostingModule {}
