import { Controller, Get, HttpCode, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { RedisHealth } from './redis.health.js';

@ApiTags('health')
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly db: PlatformPrisma,
    private readonly redis: RedisHealth,
  ) {}

  /** Liveness: the process is up. Used by Docker restart policy. */
  @Get('live')
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable. Used by Nginx/upstream checks and deploy verification. */
  @Get('ready')
  async ready() {
    const [database, redis] = await Promise.all([this.db.ping(), this.redis.ping()]);
    const body = { status: database && redis ? 'ok' : 'degraded', checks: { database, redis } };
    if (!database || !redis) throw new ServiceUnavailableException({ code: 'NOT_READY', message: 'Dependencies unavailable', details: body.checks });
    return body;
  }
}
