import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';

export interface FpUserRow { id: number; username: string; password: string; roles: string[]; enabled: boolean; action: string | null; quota: number | null; templateId: number | null }
export interface FpSiteRow { id: number; domain: string; ownerId: number }

/**
 * A stand-in for FASTPANEL's HTTP API, built from what a real FASTPANEL 8.0 server answered: Bearer tokens, replies wrapped
 * in {data} or {errors}, users that finish changes in the background ("action" CREATING/UPDATING... then null), limit
 * templates applied with PUT /api/limits/{userId}, websites made with PUT /api/master, and DELETE /api/users/{id} taking the
 * user's websites with it. It can be made busy, slow to settle, or have limits switched off.
 */
export class FakeFastpanel {
  server!: Server;
  calls: { method: string; path: string; body: unknown }[] = [];
  users = new Map<number, FpUserRow>();
  sites = new Map<number, FpSiteRow>();
  templates = new Map<number, string>([[1, 'unlimited'], [2, 'simple'], [10, 'Starter'], [11, 'Premium']]);
  limitsEnabled = true;
  /** Requests to answer with 503 before behaving. */
  busy = 0;
  /** How many reads of a user still show it busy after a change. */
  settleReads = 1;
  private nextUser = 2;
  private nextSite = 1;
  private pending = new Map<number, number>();

  constructor(private readonly port: number, private readonly token: string) {}

  async start() {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((r) => this.server.listen(this.port, '127.0.0.1', r));
  }
  stop() {
    this.server.closeAllConnections();
    this.server.close();
  }
  reset() {
    this.calls = [];
    this.users = new Map([[1, { id: 1, username: 'fastuser', password: 'admin-pass', roles: ['ROLE_SUPER_ADMIN'], enabled: true, action: null, quota: null, templateId: null }]]);
    this.sites = new Map();
    this.limitsEnabled = true;
    this.busy = 0;
    this.settleReads = 1;
    this.pending = new Map();
  }
  user(username: string) {
    return [...this.users.values()].find((u) => u.username === username);
  }
  called(method: string, prefix: string) {
    return this.calls.filter((c) => c.method === method && c.path.startsWith(prefix));
  }

  private view(u: FpUserRow) {
    const reads = this.pending.get(u.id) ?? 0;
    if (reads > 0) this.pending.set(u.id, reads - 1);
    return { id: u.id, username: u.username, roles: u.roles, enabled: u.enabled, quota: u.quota, action: reads > 0 ? u.action : null };
  }
  private busyFor(u: FpUserRow, action: string) {
    u.action = action;
    this.pending.set(u.id, this.settleReads);
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    let raw = '';
    for await (const c of req) raw += c;
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${this.token}`) return send(401, { errors: 'Unauthorized' });
    if (this.busy > 0) {
      this.busy--;
      return send(503, { errors: 'Service temporarily unavailable' });
    }
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    this.calls.push({ method: req.method ?? '', path: path + url.search, body });
    const ok = (data: unknown, status = 200) => send(status, { data });
    let m: RegExpExecArray | null;

    if (req.method === 'GET' && path === '/api/me') return ok({ id: 1, username: 'fastuser', roles: ['ROLE_SUPER_ADMIN'] });
    if (req.method === 'GET' && path === '/api/settings') return ok({ panel_version: '8.0-test', limits: this.limitsEnabled, configuration: { quota: { status: 1 } } });
    if (req.method === 'GET' && path === '/api/users') return ok([...this.users.values()].map((u) => this.view(u)));
    if (req.method === 'POST' && path === '/api/users') {
      const b = body as { username: string; password: string; roles: string; quota?: number };
      if (!b.username || !b.password) return send(400, { errors: { username: 'username is a required field' } });
      if (this.user(b.username)) return send(400, { errors: { username: `Username '${b.username}' already exists` } });
      const u: FpUserRow = { id: this.nextUser++, username: b.username, password: b.password, roles: [b.roles], enabled: true, action: null, quota: b.quota || null, templateId: null };
      this.users.set(u.id, u);
      this.busyFor(u, 'CREATING');
      return ok({ ...this.view(u), action: 'CREATING' }, 201);
    }
    if ((m = /^\/api\/users\/(\d+)(\/status)?$/.exec(path))) {
      const u = this.users.get(Number(m[1]));
      if (!u) return send(404);
      if (req.method === 'GET' && !m[2]) return ok(this.view(u));
      if (req.method === 'PUT' && m[2]) {
        u.enabled = Boolean((body as { enabled: boolean }).enabled);
        this.busyFor(u, u.enabled ? 'ENABLING' : 'DISABLING');
        return ok({ ...this.view(u), action: u.action });
      }
      if (req.method === 'PUT') {
        const b = body as { password?: string; quota?: number };
        if (b.password !== undefined) u.password = b.password;
        if (b.quota !== undefined) u.quota = b.quota || null;
        this.busyFor(u, 'UPDATING');
        return ok({ ...this.view(u), action: 'UPDATING' });
      }
      if (req.method === 'DELETE') {
        this.users.delete(u.id);
        for (const [id, s] of this.sites) if (s.ownerId === u.id) this.sites.delete(id);
        return ok({ ...this.view(u), action: 'DELETING' });
      }
    }
    if (req.method === 'GET' && path === '/api/limits/templates') return ok([...this.templates].map(([id, name]) => ({ id, name })));
    if ((m = /^\/api\/limits\/(\d+)$/.exec(path)) && req.method === 'PUT') {
      if (!this.limitsEnabled) return send(400, { errors: 'Unable to change limits, because they are disabled' });
      const u = this.users.get(Number(m[1]));
      if (!u) return send(404);
      u.templateId = (body as { template_id: number }).template_id;
      return ok({ owner_id: u.id, template_id: u.templateId });
    }
    if (req.method === 'GET' && path === '/api/sites/list') {
      return ok([...this.sites.values()].map((s) => ({ id: s.id, domain: s.domain, owner: { id: s.ownerId, username: this.users.get(s.ownerId)?.username } })));
    }
    if (req.method === 'POST' && path === '/api/master/domain') return ok({ email_domain: null, top_email_domain: null, dns_domain: null, top_dns_domain: null });
    if (req.method === 'PUT' && path === '/api/master') {
      const b = body as { domain: string; owner: number };
      if ([...this.sites.values()].some((s) => s.domain === b.domain)) return send(400, { errors: { domain: 'Site already exists' } });
      const s = { id: this.nextSite++, domain: b.domain, ownerId: b.owner };
      this.sites.set(s.id, s);
      return ok({ id: s.id, domain: s.domain, enabled: true, status: 'active' });
    }
    return send(404);
  }
}
