import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const LOG = Buffer.from('2026-11-19 error: connection refused\n');

/** Ticket attachments: accepted types, private downloads, internal notes, limits and clean-up. */
describe('Ticket attachments (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  let agent: string;
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const storeDir = (tenantId: string) => join(process.cwd(), 'storage', 'tickets', tenantId);
  const filesOnDisk = (tenantId: string) => readdir(storeDir(tenantId)).catch(() => [] as string[]);

  const newTicket = (token: string, files: [string, Buffer][], subject = 'Attachment test ticket') => {
    let r = http().post(api('tickets')).set(auth(token)).field('subject', subject).field('category', 'TECHNICAL').field('message', 'Please see the attached files.');
    for (const [name, buf] of files) r = r.attach('files', buf, name);
    return r;
  };

  let ticketId: string;
  let firstFileId: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    alice = await customer(app, db, 'att-a');
    bob = await customer(app, db, 'att-b');
    const a = await createStaff(db, 'SUPPORT_AGENT', 'attagent');
    emails.push(alice.email, bob.email, a.email);
    agent = await staffToken(app, db, a);
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.supportTicket.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: 'email.send' } });
    for (const t of tenantIds) await rm(storeDir(t), { recursive: true, force: true });
    await cleanupUsers(db, emails);
    await app.close();
  });

  it('a ticket can carry an image, a PDF and a log file; names are cleaned and files are stored privately', async () => {
    const r = await newTicket(alice.token, [['C:\\Users\\me\\Desktop\\Screen Shot.PNG', PNG], ['report.pdf', PDF], ['../../error.log', LOG]]).expect(201);
    ticketId = r.body.id;
    const t = await http().get(api(`tickets/${ticketId}`)).set(auth(alice.token)).expect(200);
    const files = t.body.messages[0].attachments as { id: string; fileName: string; contentType: string; sizeBytes: number }[];
    expect(files.map((f) => f.fileName).sort()).toEqual(['Screen Shot.png', 'error.log', 'report.pdf']);
    expect(files.find((f) => f.fileName === 'report.pdf')!.contentType).toBe('application/pdf');
    expect(files.find((f) => f.fileName === 'error.log')!.contentType).toBe('text/plain');
    expect(files.find((f) => f.fileName === 'Screen Shot.png')!.sizeBytes).toBe(PNG.length);
    firstFileId = files.find((f) => f.fileName === 'Screen Shot.png')!.id;
    expect(await filesOnDisk(alice.tenantId)).toHaveLength(3);
    const row = await db.ticketAttachment.findFirstOrThrow({ where: { id: firstFileId } });
    expect(row.storageKey).toMatch(/^tickets\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/); // random name, no user text
    expect(row.sha256).toHaveLength(64);
  });

  it('downloads are authenticated, forced to download, and byte-for-byte identical', async () => {
    const url = api(`tickets/${ticketId}/attachments/${firstFileId}`);
    await http().get(url).expect(401);
    const r = await http().get(url).set(auth(alice.token)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(Buffer.compare(r.body as Buffer, PNG)).toBe(0);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="Screen Shot\.png"/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toContain('no-store');
  });

  it('another organisation cannot download, and a wrong ticket id does not work either', async () => {
    await http().get(api(`tickets/${ticketId}/attachments/${firstFileId}`)).set(auth(bob.token)).expect(404);
    const other = await newTicket(bob.token, [['x.png', PNG]], 'Bob ticket').expect(201);
    await http().get(api(`tickets/${other.body.id}/attachments/${firstFileId}`)).set(auth(bob.token)).expect(404); // alice's file via bob's ticket
    await http().get(api(`tickets/${ticketId}/attachments/${randomUUID()}`)).set(auth(alice.token)).expect(404);
  });

  it('refuses unsupported files and leaves nothing behind', async () => {
    const before = { tickets: await db.supportTicket.count({ where: { tenantId: alice.tenantId } }), files: (await filesOnDisk(alice.tenantId)).length };
    const bad: [string, Buffer, string][] = [
      ['tool.png', Buffer.from('MZ\x90\x00\x03\x00\x00\x00 not an image'), 'an executable renamed to .png'],
      ['archive.zip', Buffer.from('PK\x03\x04restofzip'), 'a zip'],
      ['logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'an SVG'],
      ['page.html', Buffer.from('<html><script>alert(1)</script></html>'), 'html'],
      ['notes', Buffer.from('plain words without an extension'), 'text without a text extension'],
      ['binary.txt', Buffer.from([0x68, 0x69, 0x00, 0x01, 0x02]), 'binary named .txt'],
    ];
    for (const [name, buf, why] of bad) {
      const r = await newTicket(alice.token, [['ok.png', PNG], [name, buf]]); // a good file next to a bad one
      expect([r.status, why]).toEqual([415, why]);
      expect(r.body.error.code).toBe('UNSUPPORTED_FILE');
    }
    expect(await db.supportTicket.count({ where: { tenantId: alice.tenantId } })).toBe(before.tickets);
    expect(await filesOnDisk(alice.tenantId)).toHaveLength(before.files); // the good file was not kept either
  });

  it('refuses empty, oversized and too many files', async () => {
    const before = (await filesOnDisk(alice.tenantId)).length;
    expect((await newTicket(alice.token, [['empty.png', Buffer.alloc(0)]])).status).toBe(415);
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await newTicket(alice.token, [['big.png', big]])).status).toBe(413);
    const six = await newTicket(alice.token, Array.from({ length: 6 }, (_, i) => [`f${i}.png`, PNG] as [string, Buffer]));
    expect(six.status).toBeGreaterThanOrEqual(400);
    expect(six.status).toBeLessThan(500);
    expect(await filesOnDisk(alice.tenantId)).toHaveLength(before);
  });

  it('a JSON request with no files still works as before', async () => {
    const r = await http().post(api('tickets')).set(auth(alice.token)).send({ subject: 'No files here', category: 'BILLING', message: 'Just text, as before.' }).expect(201);
    const t = await http().get(api(`tickets/${r.body.id}`)).set(auth(alice.token)).expect(200);
    expect(t.body.messages[0].attachments).toEqual([]);
  });

  it('a reply can carry files; closing the door on a closed ticket removes the files again', async () => {
    const r = await http().post(api(`tickets/${ticketId}/messages`)).set(auth(alice.token)).field('body', 'Here is the second screenshot.').attach('files', PNG, 'second.png').expect(200);
    expect(r.body.messages.at(-1).attachments.map((a: { fileName: string }) => a.fileName)).toEqual(['second.png']);

    const closed = await newTicket(alice.token, [], 'To be closed').expect(201);
    await http().post(api(`tickets/${closed.body.id}/close`)).set(auth(alice.token)).expect(200);
    const before = (await filesOnDisk(alice.tenantId)).length;
    await http().post(api(`tickets/${closed.body.id}/messages`)).set(auth(alice.token)).field('body', 'late').attach('files', PNG, 'late.png').expect(409);
    expect(await filesOnDisk(alice.tenantId)).toHaveLength(before); // the upload was rolled back
  });

  it('staff files: a public reply is downloadable by the customer, an internal note is not', async () => {
    const pub = await http().post(api(`admin/tickets/${ticketId}/messages`)).set(auth(agent)).field('body', 'Here is a guide for you.').attach('files', PDF, 'guide.pdf').expect(200);
    const guide = pub.body.messages.at(-1).attachments[0] as { id: string };
    await http().get(api(`tickets/${ticketId}/attachments/${guide.id}`)).set(auth(alice.token)).expect(200);

    const note = await http().post(api(`admin/tickets/${ticketId}/messages`)).set(auth(agent)).field('body', 'internal: server log').field('isInternal', 'true').attach('files', LOG, 'server.log').expect(200);
    const noteFile = note.body.messages.at(-1);
    expect(noteFile.isInternal).toBe(true);
    const secretId = noteFile.attachments[0].id as string;

    await http().get(api(`admin/tickets/${ticketId}/attachments/${secretId}`)).set(auth(agent)).expect(200); // staff can read it
    await http().get(api(`tickets/${ticketId}/attachments/${secretId}`)).set(auth(alice.token)).expect(404); // the customer cannot
    const view = await http().get(api(`tickets/${ticketId}`)).set(auth(alice.token)).expect(200);
    expect(JSON.stringify(view.body)).not.toContain('server.log');
    await http().get(api(`admin/tickets/${ticketId}/attachments/${secretId}`)).set(auth(alice.token)).expect(403);
  });

  it('a ticket holds at most 20 files', async () => {
    const t = await newTicket(bob.token, [], 'Lots of files').expect(201);
    for (let i = 0; i < 4; i++) {
      await http().post(api(`tickets/${t.body.id}/messages`)).set(auth(bob.token)).field('body', `batch ${i}`)
        .attach('files', PNG, `a${i}.png`).attach('files', PNG, `b${i}.png`).attach('files', PNG, `c${i}.png`).attach('files', PNG, `d${i}.png`).attach('files', PNG, `e${i}.png`).expect(200);
    }
    const over = await http().post(api(`tickets/${t.body.id}/messages`)).set(auth(bob.token)).field('body', 'one more').attach('files', PNG, 'z.png').expect(413);
    expect(over.body.error.code).toBe('TOO_MANY_ATTACHMENTS');
    expect(await db.ticketAttachment.count({ where: { ticketId: t.body.id } })).toBe(20);
  });
});
