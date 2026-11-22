import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, RequirePlatform } from '../auth/decorators.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

@ApiTags('admin · dashboard')
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly svc: AdminDashboardService) {}

  @Get()
  @RequirePlatform('dashboard:read')
  summary(@CurrentUser() user: AuthUser) {
    return this.svc.summary(user);
  }
}
