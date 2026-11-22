import { Module } from '@nestjs/common';
import { StaffService } from './staff.service.js';
import { AuditController, StaffController, StaffSetupController } from './users.controller.js';

@Module({
  controllers: [StaffController, StaffSetupController, AuditController],
  providers: [StaffService],
})
export class UsersModule {}
