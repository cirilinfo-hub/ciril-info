import { Module } from '@nestjs/common';
import { AdminTenantsService } from './admin-tenants.service.js';
import { OrganisationService } from './organisation.service.js';
import { AdminTenantsController, InvitationsController, OrganisationController } from './tenants.controller.js';

@Module({
  controllers: [OrganisationController, InvitationsController, AdminTenantsController],
  providers: [OrganisationService, AdminTenantsService],
})
export class TenantsModule {}
