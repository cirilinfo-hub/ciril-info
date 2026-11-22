import { createHmac, randomUUID } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';

export interface FakeSession { id: string; url: string; status: 'open' | 'complete' | 'expired'; payment_status: 'paid' | 'unpaid'; amount_total: number; currency: string; payment_intent: string | null; form: URLSearchParams }

/** A stand-in for api.stripe.com: Checkout Sessions and refunds, with the secret key checked on every call. */
export class FakeStripe {
  server!: Server;
  sessions = new Map<string, FakeSession>();
  refunds: { form: URLSearchParams; idempotency: string | undefined }[] = [];
  idempotencyKeys: string[] = [];

  constructor(private readonly port: number, private readonly secretKey: string) {}

  async start() {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((r) => this.server.listen(this.port, '127.0.0.1', r));
  }
  stop() {
    this.server.closeAllConnections();
    this.server.close();
  }
  /** The customer paid on Stripe's page. */
  pay(id: string) {
    const s = this.sessions.get(id)!;
    s.status = 'complete';
    s.payment_status = 'paid';
    s.payment_intent = `pi_${randomUUID().slice(0, 12)}`;
    return s;
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${this.secretKey}`) return send(401, { error: { message: 'Invalid API Key provided' } });
    let raw = '';
    for await (const c of req) raw += c;
    const form = new URLSearchParams(raw);
    const idem = req.headers['idempotency-key'] as string | undefined;
    if (idem) this.idempotencyKeys.push(idem);
    const path = req.url ?? '';
    if (req.method === 'POST' && path === '/v1/checkout/sessions') {
      const id = `cs_test_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const s: FakeSession = { id, url: `https://checkout.stripe.test/pay/${id}`, status: 'open', payment_status: 'unpaid', amount_total: Number(form.get('line_items[0][price_data][unit_amount]')), currency: form.get('line_items[0][price_data][currency]')!, payment_intent: null, form };
      this.sessions.set(id, s);
      return send(200, { ...s, form: undefined });
    }
    const m = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && m) {
      const s = this.sessions.get(decodeURIComponent(m[1]!));
      return s ? send(200, { ...s, form: undefined }) : send(404, { error: { message: 'No such checkout.session' } });
    }
    if (req.method === 'POST' && path === '/v1/refunds') {
      this.refunds.push({ form, idempotency: idem });
      return send(200, { id: `re_${this.refunds.length}`, status: 'succeeded' });
    }
    return send(404, { error: { message: 'Unknown route' } });
  }
}

/** A Stripe-Signature header for this body, as Stripe would send it. */
export function stripeSignature(secret: string, body: string, at = Math.floor(Date.now() / 1000)) {
  return `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;
}
