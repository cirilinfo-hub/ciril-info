import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { UploadsService } from '../src/modules/uploads/uploads.service.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';
import { FakeS3 } from './support/fake-s3.js';

/** Files go to an S3 bucket (a pretend one on a fixed port). Set before any import reads the settings. */
const { BUCKET, KEY_ID, PORT, LOCAL_DIR } = vi.hoisted(() => {
  const c = { BUCKET: 'ci-files', KEY_ID: 'AKIATESTSTORAGE', PORT: 43923, LOCAL_DIR: '' };
  c.LOCAL_DIR = `${process.env['TEMP'] ?? '/tmp'}/ci-should-stay-empty-${Date.now()}`;
  Object.assign(process.env, {
    STORAGE_DRIVER: 's3', S3_BUCKET: c.BUCKET, S3_REGION: 'ap-south-1', S3_ACCESS_KEY_ID: c.KEY_ID, S3_SECRET_ACCESS_KEY: 'test-secret-key',
    S3_ENDPOINT: `http://127.0.0.1:${c.PORT}`, S3_FORCE_PATH_STYLE: 'true', S3_PREFIX: 'cirilinfo', STORAGE_LOCAL_DIR: c.LOCAL_DIR,
  });
  return c;
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const binary = (res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('File storage in S3 (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  const fake = new FakeS3(BUCKET, KEY_ID, PORT);
  const emails: string[] = [];
  let admin: string;
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await fake.start();
    app = await createTestApp();
    db = platformDb();
    const sa = await createStaff(db, 'SUPER_ADMIN', 's3admin');
    emails.push(sa.email);
    admin = await staffToken(app, db, sa);
    alice = await customer(app, db, `s3a-${randomUUID().slice(0, 6)}`);
    bob = await customer(app, db, `s3b-${randomUUID().slice(0, 6)}`);
    emails.push(alice.email, bob.email);
  });

  afterAll(async () => {
    await db.supportTicket.deleteMany({ where: { tenantId: { in: [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[] } } });
    await cleanupUsers(db, emails);
    await app.close();
    fake.stop();
  });

  it('a website image is stored in the bucket under the folder, served by the API, and deleted from the bucket', async () => {
    const r = await http().post('/api/v1/uploads/images').set(auth(admin)).attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' }).expect(201);
    const file = (r.body.path as string).split('/').pop()!;
    const stored = fake.objects.get(`cirilinfo/images/${file}`);
    expect(stored?.contentType).toBe('image/png');
    expect(Buffer.compare(stored!.body, PNG)).toBe(0);

    const served = await http().get(`/api/v1/uploads/images/${file}`).buffer(true).parse((res, cb) => binary(res as unknown as NodeJS.ReadableStream, cb)).expect(200);
    expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);
    expect(served.headers).toMatchObject({ 'content-type': 'image/png', 'x-content-type-options': 'nosniff' });
    await http().get('/api/v1/uploads/images/00000000-0000-4000-8000-000000000000.png').expect(404);
    await http().get('/api/v1/uploads/images/..%2F..%2F.env').expect(404);

    await app.get(UploadsService).remove(r.body.path as string);
    expect(fake.objects.has(`cirilinfo/images/${file}`)).toBe(false);
    await http().get(`/api/v1/uploads/images/${file}`).expect(404);
  });

  it('ticket attachments are stored per organisation and downloaded only by that organisation', async () => {
    const t = await http().post('/api/v1/tickets').set(auth(alice.token)).field('subject', 'S3 ticket').field('category', 'TECHNICAL').field('message', 'See the screenshot.').attach('files', PNG, 'shot.png').expect(201);
    const detail = await http().get(`/api/v1/tickets/${t.body.id}`).set(auth(alice.token)).expect(200);
    const fileId = detail.body.messages.flatMap((m: { attachments: { id: string }[] }) => m.attachments)[0].id as string;
    const keys = [...fake.objects.keys()].filter((k) => k.startsWith(`cirilinfo/tickets/${alice.tenantId}/`));
    expect(keys).toHaveLength(1);

    const dl = await http().get(`/api/v1/tickets/${t.body.id}/attachments/${fileId}`).set(auth(alice.token)).buffer(true).parse((res, cb) => binary(res as unknown as NodeJS.ReadableStream, cb)).expect(200);
    expect(Buffer.compare(dl.body as Buffer, PNG)).toBe(0);
    await http().get(`/api/v1/tickets/${t.body.id}/attachments/${fileId}`).set(auth(bob.token)).expect(404);
  });

  it('a bucket that refuses the upload fails the request, and files already written for it are removed', async () => {
    const before = fake.objects.size;
    fake.failPuts = 10; // more than the client's own retries
    const r = await http().post('/api/v1/tickets').set(auth(alice.token)).field('subject', 'S3 down').field('category', 'TECHNICAL').field('message', 'The bucket is refusing uploads.').attach('files', PNG, 'a.png');
    fake.failPuts = 0;
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(fake.objects.size).toBe(before);
    expect(await db.supportTicket.count({ where: { tenantId: alice.tenantId, subject: 'S3 down' } })).toBe(0);
  });

  it('every request is signed with the configured key, and nothing is written to the server disk', () => {
    expect(fake.requests.length).toBeGreaterThan(0);
    expect(existsSync(LOCAL_DIR)).toBe(false);
  });
});
