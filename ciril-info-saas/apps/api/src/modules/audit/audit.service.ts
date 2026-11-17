import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PlatformPrisma, type Tx } from '../../database/prisma-clients.js';
import type { RequestMeta } from '../auth/auth.types.js';

export interface AuditEntry {
  action: string; // e.g. "auth.login", "tenant.suspend"
  actorId?: string | null;
  tenantId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

const SECRET_KEYS = /pass(word)?|secret|token|code|otp|key|authorization|cookie/i;

/** Remove anything that looks like a credential before it is stored. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1)]),
  );
}

/**
 * Append-only audit trail (audit_logs). Neither runtime database role can
 * UPDATE or DELETE audit rows. Pass `tx` to record inside the same transaction
 * as the change being audited.
 */
@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(private readonly db: PlatformPrisma) {}

  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    const data: Prisma.AuditLogUncheckedCreateInput = {
      action: entry.action,
      actorId: entry.actorId ?? null,
      tenantId: entry.tenantId ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata ? (redact(entry.metadata) as Prisma.InputJsonValue) : undefined,
      ipAddress: entry.meta?.ip ?? null,
      userAgent: entry.meta?.userAgent ?? null,
      requestId: entry.meta?.requestId ?? null,
    };
    if (tx) {
      await tx.auditLog.create({ data });
      return;
    }
    try {
      await this.db.auditLog.create({ data });
    } catch (err) {
      // Outside a transaction, an audit failure must not break the user action — but it must be visible.
      this.log.error({ err, action: entry.action }, 'Failed to write audit log');
    }
  }
}
