import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createTestApp, customer, platformDb } from './utils.js';

/** Notifications: own notices only, read state, organisation scope. */
describe('Notifications (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const url = '/api/v1/notifications';
  const ids: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    alice = await customer(app, db, 'note-a');
    bob = await customer(app, db, 'note-b');
    emails.push(alice.email, bob.email);
    for (const title of ['First notice', 'Second notice', 'Third notice']) {
      const n = await db.notification.create({ data: { userId: alice.userId, tenantId: alice.tenantId, type: 'test', title, link: '/support' } });
      ids.push(n.id);
    }
    await db.notification.create({ data: { userId: bob.userId, tenantId: bob.tenantId, type: 'test', title: 'Bob only' } });
  });
  afterAll(async () => {
    await cleanupUsers(db, emails);
    await app.close();
  });

  it('requires sign-in', async () => {
    await http().get(url).expect(401);
    await http().get(`${url}/unread-count`).expect(401);
  });

  it('lists only my own notices, newest first, with the unread count', async () => {
    const r = await http().get(url).set(auth(alice.token)).expect(200);
    expect(r.body.data.map((n: { title: string }) => n.title)).toEqual(['Third notice', 'Second notice', 'First notice']);
    expect(r.body.unread).toBe(3);
    expect(JSON.stringify(r.body)).not.toContain('Bob only');
    expect((await http().get(`${url}/unread-count`).set(auth(alice.token)).expect(200)).body.count).toBe(3);
  });

  it('marking one read lowers the count, is repeatable, and filters the list', async () => {
    await http().post(`${url}/${ids[0]}/read`).set(auth(alice.token)).expect(204);
    await http().post(`${url}/${ids[0]}/read`).set(auth(alice.token)).expect(204);
    expect((await http().get(`${url}/unread-count`).set(auth(alice.token))).body.count).toBe(2);
    const unread = await http().get(`${url}?unread=true`).set(auth(alice.token)).expect(200);
    expect(unread.body.data).toHaveLength(2);
    expect(unread.body.data.some((n: { title: string }) => n.title === 'First notice')).toBe(false);
  });

  it("nobody can read or change someone else's notice", async () => {
    await http().post(`${url}/${ids[1]}/read`).set(auth(bob.token)).expect(404);
    expect((await db.notification.findUniqueOrThrow({ where: { id: ids[1]! } })).readAt).toBeNull();
    expect((await http().get(`${url}/unread-count`).set(auth(bob.token))).body.count).toBe(1);
  });

  it('read-all clears everything of mine and nothing of anyone else', async () => {
    const r = await http().post(`${url}/read-all`).set(auth(alice.token)).expect(200);
    expect(r.body.updated).toBe(2);
    expect((await http().get(`${url}/unread-count`).set(auth(alice.token))).body.count).toBe(0);
    expect((await http().get(`${url}/unread-count`).set(auth(bob.token))).body.count).toBe(1);
  });
});
