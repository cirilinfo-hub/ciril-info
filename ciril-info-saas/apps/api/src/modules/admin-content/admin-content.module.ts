import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module.js';
import { AdminDashboardController } from './admin-dashboard.controller.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminContentController } from './admin-content.controller.js';
import { AdminContentService } from './admin-content.service.js';

@Module({ imports: [UploadsModule], controllers: [AdminContentController, AdminDashboardController], providers: [AdminContentService, AdminDashboardService] })
export class AdminContentModule {}
