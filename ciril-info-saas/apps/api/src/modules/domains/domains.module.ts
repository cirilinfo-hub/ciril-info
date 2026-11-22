import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { SecretBox } from '../../common/security/crypto.js';
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
import { DomainTransferOutsService } from './domain-transfer-outs.service.js';
import { DomainNameserversService } from './domain-nameservers.service.js';
import { DomainContactsService } from './domain-contacts.service.js';
import { DomainsController } from './domains.controller.js';
import { DomainsService } from './domains.service.js';
import { RegistrarAutomationService } from './registrar-automation.service.js';
import { RegistrarGateway } from './registrar-gateway.js';
import { DOMAIN_SECRET_BOX } from './secret-box.js';

@Module({
  imports: [NotificationsModule],
  // AdminTldsController comes before AdminRegistrationsController so /admin/domains/tlds is matched first.
  controllers: [DomainsController, DomainOrdersController, DnsController, AdminTldsController, AdminRegistrationsController],
  providers: [DomainsService, DomainOrdersService, DomainTransferOutsService, DomainNameserversService, DomainContactsService, AdminTldsService, AdminRegistrationsService, DomainEventsHandler, RegistrarGateway, RegistrarAutomationService, DnsGateway, DnsService,
    { provide: DOMAIN_SECRET_BOX, inject: [ConfigService], useFactory: (config: ConfigService<Env, true>) => new SecretBox(config.get('DATA_ENCRYPTION_KEY', { infer: true })) },
  ],
  exports: [DomainEventsHandler],
})
export class DomainsModule {}
