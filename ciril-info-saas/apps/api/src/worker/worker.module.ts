import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { type Env, validateEnv } from '../config/env.js';
import { DatabaseModule } from '../database/database.module.js';
import { EventsProcessor } from './email.processor.js';
import { EVENTS_QUEUE, OutboxRelayService } from './outbox-relay.service.js';

/**
 * Background worker process (separate container from the API).
 * Phase 6 adds processors for provisioning, registrar jobs, renewals,
 * invoice generation, payment reconciliation and email delivery.
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
  providers: [OutboxRelayService, EventsProcessor],
})
export class WorkerModule {}
