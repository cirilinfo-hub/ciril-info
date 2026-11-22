import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { cleanupUsers, createStaff, createTestApp, customer, platformDb, purgeTestStaffNotices, staffToken } from './utils.js';

/** Staff notices: who is told about new tickets, customer replies and enquiries, and that they stay private. */
describe('Staff notifications (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let alice: Awaited<ReturnType<typeof customer>>;
  let agent1: { id: string; token: string };
  let agent2: { id: string; token: string };
  let finance: { id: string; token: string };
  const emails: string[] = [];
  const tag = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const notices = (userId: string, type?: string) => db.notification.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: { createdAt: 'desc' } });
  let ticketId: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    alice = await customer(app, db, 'staffnote');
    const make = async (role: string, label: string) => {
      const s = await createStaff(db, role, label);
      emails.push(s.email);
      return { id: s.id, token: await staffToken(app, db, s) };
    };
    agent1 = await make('SUPPORT_AGENT', 'sn1');
    agent2 = await make('SUPPORT_AGENT', 'sn2');
    finance = await make('FINANCE_ADMIN', 'snfin');
    emails.push(alice.email);
  });

  afterAll(async () => {
    await db.supportTicket.deleteMany({ where: { tenantId: alice.tenantId } });
    await db.contactInquiry.deleteMany({ where: { email: { endsWith: `${tag}@example.test` } } });
    await db.notification.deleteMany({ where: { type: 'inquiry.new', title: { contains: tag } } });
    await db.outboxEvent.deleteMany({ where: { tenantId: alice.tenantId, type: 'email.send' } });
    await cleanupUsers(db, emails);
    await purgeTestStaffNotices(db);
    await app.close();
  });

  it('a new ticket notifies staff who can read support, with who and what but never the message', async () => {
    const r = await http().post(api('tickets')).set(auth(alice.token)).send({ subject: `Mail down ${tag}`, category: 'EMAIL', message: 'SECRET-BODY-TEXT please help me with this.' }).expect(201);
    ticketId = r.body.id;
    for (const a of [agent1, agent2]) {
      const [n] = await notices(a.id, 'ticket.opened');
      expect(n!.title).toBe(`New ticket ${r.body.ref}`);
      expect(n!.body).toContain(`Mail down ${tag}`);
      expect(n!.body).toContain('Org staffnote'); // the organisation
      expect(n!.link).toBe(`/support/${ticketId}`);
      expect(JSON.stringify(n)).not.toContain('SECRET-BODY-TEXT');
    }
    expect(await notices(finance.id, 'ticket.opened')).toHaveLength(0); // finance cannot read support
  });

  it('an unassigned ticket gets everyone on support told of a customer reply', async () => {
    await http().post(api(`tickets/${ticketId}/messages`)).set(auth(alice.token)).send({ body: 'Any news?' }).expect(200);
    expect(await notices(agent1.id, 'ticket.customer_reply')).toHaveLength(1);
    expect(await notices(agent2.id, 'ticket.customer_reply')).toHaveLength(1);
  });

  it('once assigned, only the assigned agent hears about the next reply', async () => {
    await http().patch(api(`admin/tickets/${ticketId}`)).set(auth(agent1.token)).send({ assigneeId: agent1.id }).expect(200);
    await http().post(api(`tickets/${ticketId}/messages`)).set(auth(alice.token)).send({ body: 'Still waiting.' }).expect(200);
    expect(await notices(agent1.id, 'ticket.customer_reply')).toHaveLength(2);
    expect(await notices(agent2.id, 'ticket.customer_reply')).toHaveLength(1);
  });

  it('an assignee who has left is replaced by everyone on support', async () => {
    await db.user.update({ where: { id: agent1.id }, data: { status: 'DISABLED' } });
    try {
      await http().post(api(`tickets/${ticketId}/messages`)).set(auth(alice.token)).send({ body: 'Hello again.' }).expect(200);
      expect(await notices(agent2.id, 'ticket.customer_reply')).toHaveLength(2);
    } finally {
      await db.user.update({ where: { id: agent1.id }, data: { status: 'ACTIVE' } });
    }
  });

  it('a website enquiry notifies staff who handle enquiries, naming the visitor but not the message', async () => {
    const name = `Visitor ${tag}`;
    await http().post(api('public/inquiries')).send({ name, email: `v-${tag}@example.test`, service: 'Web Design', message: 'PRIVATE-ENQUIRY-TEXT we want a new site.', consent: true }).expect(201);
    const [n] = await notices(agent1.id, 'inquiry.new');
    expect(n!.title).toBe(`New enquiry from ${name}`);
    expect(n!.body).toBe('Web Design');
    expect(n!.link).toBe('/inquiries');
    expect(JSON.stringify(n)).not.toContain('PRIVATE-ENQUIRY-TEXT');
    expect(await notices(finance.id, 'inquiry.new')).toHaveLength(0); // finance has no inquiries:read
  });

  describe('admin notifications API', () => {
    it('needs a staff sign-in; customers are refused', async () => {
      await http().get(api('admin/notifications')).expect(401);
      await http().get(api('admin/notifications')).set(auth(alice.token)).expect(403);
      await http().get(api('admin/notifications/unread-count')).set(auth(alice.token)).expect(403);
    });

    it('lists my own notices newest first, with the unread count', async () => {
      const r = await http().get(api('admin/notifications')).set(auth(agent2.token)).expect(200);
      expect(r.body.unread).toBeGreaterThanOrEqual(3);
      expect(r.body.data.every((n: { id: string }) => n.id)).toBe(true);
      expect(r.body.data[0].title).toContain('New enquiry from');
      expect((await http().get(api('admin/notifications/unread-count')).set(auth(agent2.token)).expect(200)).body.count).toBe(r.body.unread);
      // Finance sees none of the support notices.
      const fin = await http().get(api('admin/notifications')).set(auth(finance.token)).expect(200);
      expect(JSON.stringify(fin.body)).not.toContain('New ticket');
    });

    it('marking read is personal: nobody can touch someone else’s notice', async () => {
      const [mine] = await notices(agent1.id, 'ticket.opened');
      await http().post(api(`admin/notifications/${mine!.id}/read`)).set(auth(agent2.token)).expect(404);
      expect((await db.notification.findUniqueOrThrow({ where: { id: mine!.id } })).readAt).toBeNull();
      await http().post(api(`admin/notifications/${mine!.id}/read`)).set(auth(agent1.token)).expect(204);
      await http().post(api(`admin/notifications/${mine!.id}/read`)).set(auth(agent1.token)).expect(204); // repeatable
      const unread = await http().get(api('admin/notifications?unread=true')).set(auth(agent1.token)).expect(200);
      expect(unread.body.data.some((n: { id: string }) => n.id === mine!.id)).toBe(false);
    });

    it('read-all clears only my own', async () => {
      const before2 = (await http().get(api('admin/notifications/unread-count')).set(auth(agent2.token))).body.count;
      expect(before2).toBeGreaterThan(0);
      const r = await http().post(api('admin/notifications/read-all')).set(auth(agent1.token)).expect(200);
      expect(r.body.updated).toBeGreaterThan(0);
      expect((await http().get(api('admin/notifications/unread-count')).set(auth(agent1.token))).body.count).toBe(0);
      expect((await http().get(api('admin/notifications/unread-count')).set(auth(agent2.token))).body.count).toBe(before2);
    });
  });
});
