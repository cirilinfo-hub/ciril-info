import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createTestApp, customer, platformDb } from './utils.js';

/** Billing addresses: validation, GST state, default handling, isolation and permissions. */
describe('Billing addresses (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const url = '/api/v1/organisation/addresses';
  const valid = { line1: '12 MG Road', city: 'Bengaluru', stateCode: '29', postalCode: '560001' };

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    alice = await customer(app, db, 'addr-a');
    bob = await customer(app, db, 'addr-b');
    emails.push(alice.email, bob.email);
  });
  afterAll(async () => {
    await cleanupUsers(db, emails);
    await app.close();
  });

  it('requires sign-in and lists the GST states', async () => {
    await http().get(url).expect(401);
    const r = await http().get(`${url}/states`).set(auth(alice.token)).expect(200);
    expect(r.body.find((s: { code: string }) => s.code === '29').name).toBe('Karnataka');
    expect(r.body.some((s: { code: string }) => s.code === '25' || s.code === '28')).toBe(false);
  });

  it('validates the address', async () => {
    await http().post(url).set(auth(alice.token)).send({ ...valid, stateCode: '99' }).expect(400);
    await http().post(url).set(auth(alice.token)).send({ ...valid, postalCode: '12345' }).expect(400);
    await http().post(url).set(auth(alice.token)).send({ ...valid, postalCode: '012345' }).expect(400);
    await http().post(url).set(auth(alice.token)).send({ ...valid, line1: '' }).expect(400);
  });

  it('the first address becomes the default and the state name comes from the code', async () => {
    const a = await http().post(url).set(auth(alice.token)).send(valid).expect(201);
    expect(a.body).toMatchObject({ isDefault: true, state: 'Karnataka', stateCode: '29', country: 'IN', label: 'Billing' });
  });

  it('a new default replaces the old one; the default cannot be unset directly', async () => {
    const first = (await http().get(url).set(auth(alice.token)).expect(200)).body[0];
    const second = (await http().post(url).set(auth(alice.token)).send({ ...valid, label: 'Pune office', city: 'Pune', stateCode: '27', postalCode: '411001', isDefault: true }).expect(201)).body;
    expect(second.isDefault).toBe(true);
    const list = (await http().get(url).set(auth(alice.token)).expect(200)).body;
    expect(list.filter((x: { isDefault: boolean }) => x.isDefault)).toHaveLength(1);
    expect(list[0].id).toBe(second.id);
    const r = await http().patch(`${url}/${second.id}`).set(auth(alice.token)).send({ isDefault: false }).expect(409);
    expect(r.body.error.code).toBe('DEFAULT_REQUIRED');
    const edited = await http().patch(`${url}/${first.id}`).set(auth(alice.token)).send({ stateCode: '07', city: 'New Delhi', postalCode: '110001' }).expect(200);
    expect(edited.body.state).toBe('Delhi');
  });

  it('deleting the default promotes the remaining address', async () => {
    const [def, other] = (await http().get(url).set(auth(alice.token)).expect(200)).body;
    await http().delete(`${url}/${def.id}`).set(auth(alice.token)).expect(204);
    const left = (await http().get(url).set(auth(alice.token)).expect(200)).body;
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: other.id, isDefault: true });
  });

  it('another organisation cannot see or change it', async () => {
    const mine = (await http().get(url).set(auth(alice.token)).expect(200)).body[0];
    expect((await http().get(url).set(auth(bob.token)).expect(200)).body).toHaveLength(0);
    await http().patch(`${url}/${mine.id}`).set(auth(bob.token)).send({ city: 'Hacked' }).expect(404);
    await http().delete(`${url}/${mine.id}`).set(auth(bob.token)).expect(404);
    expect((await db.customerAddress.findUniqueOrThrow({ where: { id: mine.id } })).city).not.toBe('Hacked');
  });
});
