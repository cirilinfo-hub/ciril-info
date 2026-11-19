import type { PlatformPrisma } from '../../database/prisma-clients.js';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Seller details printed on an invoice, copied from the company profile the admins maintain. Only what has
 * been filled in is kept, so nothing is invented, and later profile edits never rewrite an issued invoice.
 */
export async function readSeller(db: PlatformPrisma): Promise<Prisma.InputJsonObject> {
  const row = await db.systemSetting.findUnique({ where: { key: 'company.profile' } });
  const v = (row?.value ?? {}) as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : undefined);
  const a = (v['address'] ?? {}) as Record<string, unknown>;
  const address = Object.fromEntries(['line1', 'line2', 'city', 'state', 'stateCode', 'postalCode'].map((k) => [k, text(a[k])]).filter(([, x]) => x));
  return Object.fromEntries(
    Object.entries({ name: text(v['legalName']) ?? text(v['brandName']), gstin: text(v['gstin']), email: text(v['email']), phone: text(v['phone']), address: Object.keys(address).length ? address : undefined })
      .filter(([, x]) => x !== undefined),
  ) as Prisma.InputJsonObject;
}
