import { Module } from '@nestjs/common';
import { AdminTenantsService } from './admin-tenants.service.js';
import { AddressesService } from './addresses.service.js';
import { OrganisationService } from './organisation.service.js';
import { AddressesController, AdminTenantsController, InvitationsController, OrganisationController } from './tenants.controller.js';

@Module({
  controllers: [OrganisationController, AddressesController, InvitationsController, AdminTenantsController],
  providers: [OrganisationService, AddressesService, AdminTenantsService],
})
export class TenantsModule {}
