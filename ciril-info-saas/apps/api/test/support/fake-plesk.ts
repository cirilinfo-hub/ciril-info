import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';

export interface PleskSub { owner: string; plan: string; ip: string; login: string; active: boolean }

/**
 * A stand-in for a Plesk server's REST API "cli" gateway (/api/v2/cli/{customer,subscription}/call). It checks the
 * X-API-Key header, keeps customers and subscriptions in memory, answers like Plesk's command-line tools (exit code,
 * stdout, stderr), and can be made busy or strict about service plans.
 */
export class FakePlesk {
  server!: Server;
  calls: { tool: string; params: string[] }[] = [];
  customers = new Map<string, { email: string }>();
  subscriptions = new Map<string, PleskSub>();
  plans = new Set(['Basic', 'Pro']);
  busy = 0;

  constructor(private readonly port: number, private readonly apiKey: string) {}

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
    this.busy = 0;
  }
  called(tool: string, op: string) {
    return this.calls.filter((c) => c.tool === tool && c.params[0] === op);
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    let raw = '';
    for await (const c of req) raw += c;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-api-key'] !== this.apiKey) return send(401, { code: 1, message: 'Authentication failed' });
    const m = /^\/api\/v2\/cli\/(customer|subscription)\/call$/.exec(req.url ?? '');
    if (!m || req.method !== 'POST') return send(404, { message: 'Not found' });
    if (this.busy > 0) {
      this.busy--;
      return send(503, { message: 'Service temporarily unavailable' });
    }
    const params = (JSON.parse(raw) as { params: string[] }).params;
    this.calls.push({ tool: m[1]!, params });
    const ok = (stdout = 'SUCCESS') => send(200, { code: 0, stdout, stderr: '' });
    const fail = (stderr: string) => send(200, { code: 1, stdout: '', stderr });
    const opt = (name: string) => params[params.indexOf(name) + 1]!;
    const [op, name] = params as [string, string];

    if (m[1] === 'customer') {
      if (op === '--create') {
        if (this.customers.has(name)) return fail(`Unable to create the customer: customer with login ${name} already exists`);
        this.customers.set(name, { email: opt('-email') });
        return ok(`SUCCESS: Creation of customer '${name}' completed.`);
      }
      if (op === '--remove') {
        if (!this.customers.delete(name)) return fail(`Customer with login ${name} does not exist`);
        return ok();
      }
      return fail(`Unknown option ${op}`);
    }

    const sub = this.subscriptions.get(name);
    if (op === '--create') {
      if (sub) return fail(`Domain ${name} already exists`);
      if (!this.plans.has(opt('-service-plan'))) return fail(`Service plan "${opt('-service-plan')}" does not exist`);
      if (!this.customers.has(opt('-owner'))) return fail(`Customer with login ${opt('-owner')} does not exist`);
      this.subscriptions.set(name, { owner: opt('-owner'), plan: opt('-service-plan'), ip: opt('-ip'), login: opt('-login'), active: true });
      return ok(`SUCCESS: Creation of subscription '${name}' completed.`);
    }
    if (!sub) return fail(`Unable to find domain ${name}: subscription does not exist`);
    if (op === '--info') return ok(`General\n=======\nDomain name:  ${name}\nOwner's contact name:  ${sub.owner} (${sub.owner})\nService plan: ${sub.plan}\n`);
    if (op === '--webspace-off') { sub.active = false; return ok(); }
    if (op === '--webspace-on') { sub.active = true; return ok(); }
    if (op === '--switch-subscription') {
      if (!this.plans.has(opt('-service-plan'))) return fail(`Service plan "${opt('-service-plan')}" does not exist`);
      sub.plan = opt('-service-plan');
      return ok();
    }
    if (op === '--remove') { this.subscriptions.delete(name); return ok(); }
    return fail(`Unknown option ${op}`);
  }
}
