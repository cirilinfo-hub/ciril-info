import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';
import { EICAR, FakeClamd } from './support/fake-clamd.js';

/** Uploads checked by ClamAV (a pretend clamd on a fixed port). Set before any import reads the settings. */
const { PORT } = vi.hoisted(() => {
  const c = { PORT: 43925 };
  Object.assign(process.env, { VIRUS_SCAN: 'clamav', CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: String(c.PORT), CLAMAV_TIMEOUT_MS: '3000' });
  return c;
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('Virus scanning of uploads (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  const clamd = new FakeClamd(PORT);
  const emails: string[] = [];
  let admin: string;
  let alice: Awaited<ReturnType<typeof customer>>;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const ticket = (subject: string, files: [string, Buffer][]) => {
    let r = http().post('/api/v1/tickets').set(auth(alice.token)).field('subject', subject).field('category', 'TECHNICAL').field('message', 'Please look at the attached file.');
    for (const [name, buf] of files) r = r.attach('files', buf, name);
    return r;
  };

  beforeAll(async () => {
    await clamd.start();
    app = await createTestApp();
    db = platformDb();
    const sa = await createStaff(db, 'SUPER_ADMIN', 'avadmin');
    admin = await staffToken(app, db, sa);
    alice = await customer(app, db, `av-${randomUUID().slice(0, 6)}`);
    emails.push(sa.email, alice.email);
  });

  afterAll(async () => {
    await db.supportTicket.deleteMany({ where: { tenantId: alice?.tenantId } });
    await cleanupUsers(db, emails);
    await app.close();
    await clamd.stop().catch(() => undefined);
  });

  it('a clean attachment is checked and kept', async () => {
    const before = clamd.received.length;
    await ticket('Clean file', [['notes.txt', Buffer.from('All good here.\n')]]).expect(201);
    expect(clamd.received.length).toBe(before + 1);
    expect(clamd.received.at(-1)!.toString()).toBe('All good here.\n');
  });

  it('an infected attachment is refused with the signature, nothing is kept, and it is recorded', async () => {
    const r = await ticket('Infected file', [['ok.txt', Buffer.from('fine')], ['report.txt', Buffer.from(EICAR)]]).expect(422);
    expect(r.body.error).toMatchObject({ code: 'FILE_INFECTED', message: expect.stringContaining('"report.txt"') });
    expect(await db.supportTicket.count({ where: { tenantId: alice.tenantId, subject: 'Infected file' } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'upload.infected', tenantId: alice.tenantId } })).toBe(1);
  });

  it('an infected website image is refused too', async () => {
    const img = Buffer.concat([PNG, Buffer.from(EICAR)]); // still starts like a PNG, so only the scan catches it
    const r = await http().post('/api/v1/uploads/images').set(auth(admin)).attach('file', img, { filename: 'logo.png', contentType: 'image/png' }).expect(422);
    expect(r.body.error.code).toBe('FILE_INFECTED');
    await http().post('/api/v1/uploads/images').set(auth(admin)).attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' }).expect(201);
  });

  it('when the scanner is down, uploads are refused rather than kept unchecked; text-only tickets still work', async () => {
    await clamd.stop();
    try {
      const r = await ticket('Scanner down', [['notes.txt', Buffer.from('hello')]]).expect(503);
      expect(r.body.error.code).toBe('SCANNER_UNAVAILABLE');
      expect(await db.supportTicket.count({ where: { tenantId: alice.tenantId, subject: 'Scanner down' } })).toBe(0);
      await http().post('/api/v1/tickets').set(auth(alice.token)).send({ subject: 'No files at all', category: 'BILLING', message: 'Just a question about my invoice.' }).expect(201);
    } finally {
      await clamd.start();
    }
  });
});
