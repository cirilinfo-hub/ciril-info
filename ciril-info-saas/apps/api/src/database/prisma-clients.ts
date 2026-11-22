import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';

export type Tx = Prisma.TransactionClient;

/** Identity of the caller for tenant-scoped database work. */
export interface TenantScope {
  tenantId: string;
  userId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Customer-facing database access. Connects as `cirilinfo_app` (NOBYPASSRLS).
 *
 * The ONLY way to run queries is `run(scope, fn)`, which opens a transaction and
 * sets `app.tenant_id` / `app.user_id` with SET LOCAL semantics. PostgreSQL RLS
 * then restricts every statement to that tenant. Outside `run`, policies match
 * nothing, so a forgotten scope fails closed rather than leaking data.
 */
@Injectable()
export class TenantPrisma implements OnModuleDestroy {
  private readonly client: PrismaClient;

  constructor(config: ConfigService<Env, true>) {
    this.client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL_APP', { infer: true }) }),
    });
  }

  async run<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>, opts?: { timeoutMs?: number }): Promise<T> {
    if (!UUID_RE.test(scope.tenantId) || !UUID_RE.test(scope.userId)) {
      throw new Error('TenantPrisma.run: invalid tenant scope');
    }
    return this.client.$transaction(
      async (tx) => {
        // set_config(..., is_local => true) == SET LOCAL: reset at COMMIT/ROLLBACK,
        // so pooled connections never carry another tenant's context.
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${scope.tenantId}, true), set_config('app.user_id', ${scope.userId}, true)`;
        return fn(tx);
      },
      { timeout: opts?.timeoutMs ?? 10_000 },
    );
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}

/**
 * Platform database access. Connects as `cirilinfo_platform` (BYPASSRLS).
 * Use only from admin-portal controllers protected by platform permissions,
 * authentication flows (before a tenant is known), and background workers.
 */
@Injectable()
export class PlatformPrisma extends PrismaClient implements OnModuleDestroy {
  private readonly log = new Logger(PlatformPrisma.name);

  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL_PLATFORM', { infer: true }) }),
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (err) {
      this.log.warn(`Database ping failed: ${(err as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
