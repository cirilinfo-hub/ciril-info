import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, staffToken } from './utils.js';

/** Support tickets: customer isolation, hidden internal notes, status flow, notifications and permissions. */
describe('Support tickets (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  let agent: string;
  let finance: string;
  let agentUser: { id: string; email: string };
  const emails: string[] = [];

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    alice = await customer(app, db, 'sup-a');
    bob = await customer(app, db, 'sup-b');
    const a = await createStaff(db, 'SUPPORT_AGENT', 'supagent');
    const f = await createStaff(db, 'FINANCE_ADMIN', 'supfin');
    agentUser = a;
    emails.push(alice.email, bob.email, a.email, f.email);
    [agent, finance] = await Promise.all([staffToken(app, db, a), staffToken(app, db, f)]);
  });

  afterAll(async () => {
    const tenantIds = [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[];
    await db.supportTicket.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds }, type: 'email.send' } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  let ticketId: string;

  it('requires sign-in, a valid subject and a message', async () => {
    await http().get(api('tickets')).expect(401);
    await http().post(api('tickets')).set(auth(alice.token)).send({ subject: 'Hi', category: 'BILLING', message: 'short' }).expect(400);
    await http().post(api('tickets')).set(auth(alice.token)).send({ subject: 'Valid subject', category: 'NOPE', message: 'A long enough message.' }).expect(400);
    await http().post(api('tickets')).set(auth(alice.token)).send({ subject: 'Valid subject', category: 'BILLING', priority: 'URGENT', message: 'A long enough message.' }).expect(400);
  });

  it('a customer opens a ticket and sees it', async () => {
    const r = await http().post(api('tickets')).set(auth(alice.token)).send({ subject: 'My site is down', category: 'HOSTING', priority: 'HIGH', message: 'The homepage shows an error since this morning.' }).expect(201);
    ticketId = r.body.id;
    expect(r.body.ref).toMatch(/^TKT-\d+$/);
    expect(r.body.status).toBe('OPEN');
    const list = await http().get(api('tickets')).set(auth(alice.token)).expect(200);
    expect(list.body.data.map((t: { id: string }) => t.id)).toContain(ticketId);
    const one = await http().get(api(`tickets/${ticketId}`)).set(auth(alice.token)).expect(200);
    expect(one.body.messages).toHaveLength(1);
    expect(one.body.messages[0].isYou).toBe(true);
  });

  it('another organisation cannot see, reply to or close it', async () => {
    await http().get(api(`tickets/${ticketId}`)).set(auth(bob.token)).expect(404);
    await http().post(api(`tickets/${ticketId}/messages`)).set(auth(bob.token)).send({ body: 'hello' }).expect(404);
    await http().post(api(`tickets/${ticketId}/close`)).set(auth(bob.token)).expect(404);
    const list = await http().get(api('tickets')).set(auth(bob.token)).expect(200);
    expect(list.body.data).toHaveLength(0);
  });

  it('staff permissions: support can work tickets, finance cannot', async () => {
    await http().get(api('admin/tickets')).set(auth(finance)).expect(403);
    await http().get(api('admin/tickets')).set(auth(alice.token)).expect(403);
    const list = await http().get(api('admin/tickets?search=site is down')).set(auth(agent)).expect(200);
    expect(list.body.data.some((t: { id: string; tenant: { name: string } }) => t.id === ticketId)).toBe(true);
  });

  it('an internal note is invisible to the customer and does not change the ticket', async () => {
    await http().post(api(`admin/tickets/${ticketId}/messages`)).set(auth(agent)).send({ body: 'INTERNAL: checking with the server team', isInternal: true }).expect(200);
    const staffView = await http().get(api(`admin/tickets/${ticketId}`)).set(auth(agent)).expect(200);
    expect(staffView.body.messages.some((m: { isInternal: boolean }) => m.isInternal)).toBe(true);
    expect(staffView.body.status).toBe('OPEN');
    const customerView = await http().get(api(`tickets/${ticketId}`)).set(auth(alice.token)).expect(200);
    expect(JSON.stringify(customerView.body)).not.toContain('INTERNAL');
    expect(customerView.body.messages).toHaveLength(1);
  });

  it('a staff reply waits on the customer, notifies them, and never puts the text in the email', async () => {
    const r = await http().post(api(`admin/tickets/${ticketId}/messages`)).set(auth(agent)).send({ body: 'We restarted your site. Please check now.' }).expect(200);
    expect(r.body.status).toBe('AWAITING_CUSTOMER');
    expect(r.body.assignee.email).toBe(agentUser.email);

    const view = await http().get(api(`tickets/${ticketId}`)).set(auth(alice.token)).expect(200);
    expect(view.body.status).toBe('AWAITING_CUSTOMER');
    const last = view.body.messages.at(-1);
    expect(last.fromStaff).toBe(true);
    expect(last.authorName).toContain('Ciril Info Support');
    expect(JSON.stringify(view.body)).not.toContain(agentUser.email);

    const note = await db.notification.findFirst({ where: { userId: alice.userId, type: 'ticket.reply' } });
    expect(note?.title).toMatch(/^New reply on TKT-/);
    const mail = await db.outboxEvent.findFirst({ where: { tenantId: alice.tenantId, type: 'email.send', payload: { path: ['template'], equals: 'ticket-reply' } } });
    expect(mail).toBeTruthy();
    expect(JSON.stringify(mail!.payload)).not.toContain('restarted your site');
  });

  it('a customer reply reopens it for staff', async () => {
    const r = await http().post(api(`tickets/${ticketId}/messages`)).set(auth(alice.token)).send({ body: 'Works now, thank you.' }).expect(200);
    expect(r.body.status).toBe('OPEN');
    expect(r.body.messages).toHaveLength(3); // first message, staff reply, this reply (the internal note is hidden)
  });

  it('staff can reprioritise, assign and resolve; a bad assignee is refused', async () => {
    await http().patch(api(`admin/tickets/${ticketId}`)).set(auth(agent)).send({ assigneeId: alice.userId }).expect(409); // a customer is not staff
    const r = await http().patch(api(`admin/tickets/${ticketId}`)).set(auth(agent)).send({ priority: 'URGENT', status: 'RESOLVED', assigneeId: agentUser.id }).expect(200);
    expect(r.body.priority).toBe('URGENT');
    expect(r.body.status).toBe('RESOLVED');
    expect(r.body.resolvedAt).toBeTruthy();
    const mine = await http().get(api('admin/tickets?assignee=me&status=RESOLVED')).set(auth(agent)).expect(200);
    expect(mine.body.data.map((t: { id: string }) => t.id)).toContain(ticketId);
  });

  it('closing is final: no more replies from either side', async () => {
    const r = await http().post(api(`tickets/${ticketId}/close`)).set(auth(alice.token)).expect(200);
    expect(r.body.status).toBe('CLOSED');
    const c = await http().post(api(`tickets/${ticketId}/messages`)).set(auth(alice.token)).send({ body: 'one more thing' }).expect(409);
    expect(c.body.error.code).toBe('TICKET_CLOSED');
    await http().post(api(`admin/tickets/${ticketId}/messages`)).set(auth(agent)).send({ body: 'late reply' }).expect(409);
    // Staff can reopen it.
    const reopened = await http().patch(api(`admin/tickets/${ticketId}`)).set(auth(agent)).send({ status: 'OPEN' }).expect(200);
    expect(reopened.body.status).toBe('OPEN');
  });

  it('records the actions in the audit log', async () => {
    const actions = (await db.auditLog.findMany({ where: { entityId: ticketId } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['ticket.open', 'ticket.reply', 'ticket.staff_reply', 'ticket.note', 'ticket.update', 'ticket.close']));
  });
});
