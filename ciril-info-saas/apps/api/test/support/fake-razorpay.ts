import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';

export interface FakeRzpPayment { id: string; order_id: string; amount: number; currency: string; status: string; method?: string; error_description?: string; token_id?: string }
export interface FakeRzpToken { id: string; card?: { last4: string; network: string; expiry_month: number; expiry_year: number }; recurring_details?: { status: string; failure_reason?: string | null } }

/**
 * A stand-in for api.razorpay.com with saved cards (Razorpay recurring payments): customers, card tokens and charges on
 * a saved token. It checks the key pair on every call and records what it was asked, so tests can see exactly what
 * would have reached Razorpay.
 */
export class FakeRazorpay {
  server!: Server;
  base = '';
  orders: { id: string; amount: number; currency: string; receipt: string; notes: Record<string, string>; customer_id?: string; method?: string; token?: { max_amount: number; expire_at: number; frequency: string } }[] = [];
  payments = new Map<string, FakeRzpPayment>();
  customers = new Map<string, { id: string; name: string; email: string; contact: string }>();
  tokens = new Map<string, FakeRzpToken[]>();
  recurring: { order_id: string; customer_id: string; token: string; amount: number; currency: string; email: string; contact: string; recurring: string; paymentId: string | null }[] = [];
  deletedTokens: string[] = [];
  /** Tokens whose charges the card's bank refuses. */
  declineTokens = new Set<string>();
  /** Answer the next recurring charges with a server error (an outage). */
  failRecurring = 0;

  constructor(private readonly keyId: string, private readonly keySecret: string, private readonly port: number) {}

  async start() {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((r) => this.server.listen(this.port, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${this.port}`;
  }
  stop() {
    this.server.close();
  }
  addPayment(p: FakeRzpPayment) {
    this.payments.set(p.id, p);
  }
  addToken(customerId: string, t: FakeRzpToken) {
    this.tokens.set(customerId, [...(this.tokens.get(customerId) ?? []), t]);
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`) return send(401, { error: { description: 'Authentication failed' } });
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, any>) : {};
    const path = new URL(req.url ?? '/', this.base).pathname;

    if (req.method === 'POST' && path === '/orders') {
      const o = { id: `order_${this.orders.length + 1}${randomUUID().slice(0, 6)}`, ...body } as FakeRazorpay['orders'][number];
      this.orders.push(o);
      return send(200, { ...o, status: 'created' });
    }
    if (req.method === 'POST' && path === '/customers') {
      const known = [...this.customers.values()].find((c) => c.email === body['email'] && c.contact === body['contact']);
      if (known) return send(200, known);
      const c = { id: `cust_${randomUUID().slice(0, 10)}`, name: body['name'], email: body['email'], contact: body['contact'] };
      this.customers.set(c.id, c);
      return send(200, c);
    }
    if (req.method === 'POST' && path === '/payments/create/recurring') {
      if (this.failRecurring > 0) {
        this.failRecurring--;
        return send(503, { error: { description: 'Service unavailable' } });
      }
      const declined = this.declineTokens.has(body['token']);
      const id = declined ? null : `pay_${randomUUID().slice(0, 10)}`;
      this.recurring.push({ ...(body as FakeRazorpay['recurring'][number]), paymentId: id });
      if (declined) return send(400, { error: { description: 'Your card was declined by the bank' } });
      this.addPayment({ id: id!, order_id: body['order_id'], amount: body['amount'], currency: body['currency'], status: 'created', method: 'card', token_id: body['token'] });
      return send(200, { razorpay_payment_id: id, razorpay_order_id: body['order_id'], razorpay_signature: 'sig' });
    }
    let m = path.match(/^\/customers\/([^/]+)\/tokens$/);
    if (req.method === 'GET' && m) return send(200, { entity: 'collection', items: this.tokens.get(m[1]!) ?? [] });
    m = path.match(/^\/customers\/([^/]+)\/tokens\/([^/]+)$/);
    if (req.method === 'DELETE' && m) {
      this.deletedTokens.push(m[2]!);
      this.tokens.set(m[1]!, (this.tokens.get(m[1]!) ?? []).filter((t) => t.id !== m![2]));
      return send(200, { deleted: true });
    }
    m = path.match(/^\/payments\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const p = this.payments.get(m[1]!);
      return p ? send(200, p) : send(404, { error: { description: 'not found' } });
    }
    m = path.match(/^\/payments\/([^/]+)\/capture$/);
    if (req.method === 'POST' && m) {
      const p = this.payments.get(m[1]!);
      if (!p) return send(404, { error: { description: 'not found' } });
      p.status = 'captured';
      return send(200, p);
    }
    m = path.match(/^\/orders\/([^/]+)\/payments$/);
    if (req.method === 'GET' && m) return send(200, { items: [...this.payments.values()].filter((p) => p.order_id === m![1]) });
    m = path.match(/^\/payments\/([^/]+)\/refund$/);
    if (req.method === 'POST' && m) return send(200, { id: `rfnd_${randomUUID().slice(0, 6)}`, status: 'processed' });
    return send(404, { error: { description: 'unknown route' } });
  }
}
