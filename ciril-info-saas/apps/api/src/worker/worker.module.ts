import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { type Env, validateEnv } from '../config/env.js';
import { DatabaseModule } from '../database/database.module.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { BillingLifecycleService } from '../modules/billing/billing-lifecycle.service.js';
import { PaymentGateway } from '../modules/billing/payment-gateway.js';
import { PaymentSettlementService } from '../modules/billing/payment-settlement.service.js';
import { AutoPayService } from '../modules/billing/autopay.service.js';
import { SavedCardsService } from '../modules/billing/saved-cards.service.js';
import { SecretBox } from '../common/security/crypto.js';
import { AdminRegistrationsService } from '../modules/domains/admin-registrations.service.js';
import { DomainEventsHandler } from '../modules/domains/domain-events.handler.js';
import { RegistrarAutomationService } from '../modules/domains/registrar-automation.service.js';
import { RegistrarGateway } from '../modules/domains/registrar-gateway.js';
import { DOMAIN_SECRET_BOX } from '../modules/domains/secret-box.js';
import { HostingEventsHandler } from '../modules/hosting/hosting-events.handler.js';
import { HostingGateway } from '../modules/hosting/hosting-gateway.js';
import { HostingJobsService } from '../modules/hosting/hosting-jobs.service.js';
import { HostingProvisionerRunner } from './hosting-provisioner.runner.js';
import { StaffNotifier } from '../modules/notifications/staff-notifier.service.js';
import { MailService } from '../modules/mail/mail.service.js';
import { BillingLifecycleRunner } from './billing-lifecycle.runner.js';
import { EventsProcessor } from './email.processor.js';
import { EVENTS_QUEUE, OutboxRelayService } from './outbox-relay.service.js';

/**
 * Background worker process (separate container from the API).
 * Today: outbox relay, email delivery and the billing lifecycle (renewal invoices, overdue, expiry).
 * Phase 6 adds provisioning, registrar jobs and payment reconciliation.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath: ['.env', '../../.env'], validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          customProps: () => ({ service: 'worker' }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
              : undefined,
        },
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: {
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          password: config.get('REDIS_PASSWORD', { infer: true }),
        },
        prefix: 'ci',
      }),
    }),
    BullModule.registerQueue({ name: EVENTS_QUEUE }),
    DatabaseModule,
  ],
  providers: [OutboxRelayService, EventsProcessor, AuditService, MailService, StaffNotifier, PaymentGateway, SavedCardsService, PaymentSettlementService, AutoPayService, BillingLifecycleService, BillingLifecycleRunner, HostingGateway, HostingJobsService, HostingEventsHandler, HostingProvisionerRunner, DomainEventsHandler,
    RegistrarGateway, AdminRegistrationsService, RegistrarAutomationService,
    { provide: DOMAIN_SECRET_BOX, inject: [ConfigService], useFactory: (config: ConfigService<Env, true>) => new SecretBox(config.get('DATA_ENCRYPTION_KEY', { infer: true })) },
  ],
})
export class WorkerModule {}
