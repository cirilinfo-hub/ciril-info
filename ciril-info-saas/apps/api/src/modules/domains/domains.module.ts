import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdminTldsController } from './admin-tlds.controller.js';
import { AdminTldsService } from './admin-tlds.service.js';
import { AdminRegistrationsController } from './admin-registrations.controller.js';
import { AdminRegistrationsService } from './admin-registrations.service.js';
import { DnsController } from './dns/dns.controller.js';
import { DnsGateway, DnsService } from './dns/dns.service.js';
import { DomainEventsHandler } from './domain-events.handler.js';
import { DomainOrdersController } from './domain-orders.controller.js';
import { DomainOrdersService } from './domain-orders.service.js';
import { DomainsController } from './domains.controller.js';
import { DomainsService } from './domains.service.js';
import { RegistrarGateway } from './registrar-gateway.js';

@Module({
  imports: [NotificationsModule],
  // AdminTldsController comes before AdminRegistrationsController so /admin/domains/tlds is matched first.
  controllers: [DomainsController, DomainOrdersController, DnsController, AdminTldsController, AdminRegistrationsController],
  providers: [DomainsService, DomainOrdersService, AdminTldsService, AdminRegistrationsService, DomainEventsHandler, RegistrarGateway, DnsGateway, DnsService],
  exports: [DomainEventsHandler],
})
export class DomainsModule {}
