import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { RedisHealth } from './redis.health.js';

@Module({
  controllers: [HealthController],
  providers: [RedisHealth],
})
export class HealthModule {}
