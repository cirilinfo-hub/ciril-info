import type { Tx } from '../../database/prisma-clients.js';
import { financialYear, invoiceNumber } from './billing.logic.js';

/** Atomic and gap-free per financial year: the counter row stays locked until the caller's transaction ends. */
export async function nextInvoiceNumber(tx: Tx, at: Date): Promise<string> {
  const fy = financialYear(at);
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO document_counters ("key", "value") VALUES (${`invoice:${fy}`}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = document_counters."value" + 1
    RETURNING "value"`;
  return invoiceNumber(fy, rows[0]!.value);
}
