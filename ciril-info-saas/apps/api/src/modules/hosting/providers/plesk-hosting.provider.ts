import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { type CreateAccountRequest, type CreateAccountResult, type HostingProvider, ProvisioningError } from './hosting-provider.js';

export interface PleskConfig {
  host: string;
  port: number;
  /** A Plesk API key (made on the server with `plesk bin secret_key -c`). Sent as X-API-Key. */
  apiKey: string;
  /** verify: normal HTTPS. skip: HTTPS without checking the certificate (a fresh server's self-signed one). off: plain HTTP, tests only. */
  tls: 'verify' | 'skip' | 'off';
  /** The server's shared IPv4 address, which new subscriptions are put on. */
  ip: string;
  timeoutMs?: number;
}

/** What Plesk's command-line tools say when the thing is not there. */
const NOT_FOUND = /does not exist|not found|unable to find|no such/i;
const BUSY = /busy|try again|locked|temporar|timed? ?out|overload/i;
const CERT_ERRORS = new Set(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);
const MAX_BODY = 1_000_000;

interface CliReply { code: number; stdout: string; stderr: string }

/**
 * Creates and manages hosting through Plesk's REST API (Obsidian), by calling its standard command-line tools over the
 * API's "cli" gateway (`customer` and `subscription`). Each hosting account is a Plesk customer of its own (login = the
 * panel username, so the customer can sign in to Plesk and reset the password there), owning one subscription for the
 * domain, on a service plan named like the plan's panel package.
 *
 * Calls are safe to repeat: creating something that already exists for the same domain is a success, and suspending,
 * restoring or removing something already in that state is too. A timeout, a refused connection or a busy panel can be
 * retried; anything else goes to staff with Plesk's own words.
 */
export class PleskHostingProvider implements HostingProvider {
  readonly id = 'PLESK' as const;
  readonly mode = 'automatic' as const;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: PleskConfig) {
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
  }

  async createAccount(req: CreateAccountRequest): Promise<CreateAccountResult> {
    if (!req.packageName) throw new ProvisioningError('This plan has no panel package set (the Plesk service plan name). An admin needs to set one.', false);
    const existing = await this.subscriptionOwner(req.domain);
    if (existing !== null) {
      if (existing === req.username) return { panelUsername: req.username, serverName: this.cfg.host };
      throw new ProvisioningError(`${req.domain} already exists on the Plesk server under another customer.`, false);
    }
    const password = `${randomBytes(18).toString('base64url')}-Aa9`;
    // The customer first (a retry finds it already made), then the subscription it owns.
    await this.cli('customer', ['--create', req.username, '-email', req.contactEmail, '-name', req.username, '-passwd', password, '-notify', 'true'], password, /already exists/i);
    await this.cli('subscription', ['--create', req.domain, '-owner', req.username, '-service-plan', req.packageName, '-ip', this.cfg.ip, '-login', req.username, '-passwd', password], password);
    return { panelUsername: req.username, serverName: this.cfg.host };
  }

  async suspend(req: { panelUsername: string; domain: string; reason: string }): Promise<void> {
    await this.cli('subscription', ['--webspace-off', req.domain], undefined, /already|is disabled|is suspended/i);
  }

  async unsuspend(req: { panelUsername: string; domain: string }): Promise<void> {
    await this.cli('subscription', ['--webspace-on', req.domain], undefined, /already|is active|is enabled/i);
  }

  async changePackage(req: { panelUsername: string; domain: string; packageName: string }): Promise<void> {
    await this.cli('subscription', ['--switch-subscription', req.domain, '-service-plan', req.packageName]);
  }

  async terminate(req: { panelUsername: string; domain: string }): Promise<void> {
    await this.cli('subscription', ['--remove', req.domain], undefined, NOT_FOUND);
    // The customer account is removed too when it has nothing else left.
    await this.cli('customer', ['--remove', req.panelUsername], undefined, NOT_FOUND).catch((e) => {
      if (!(e instanceof ProvisioningError) || e.retryable) throw e;
    });
  }

  async ping(): Promise<string> {
    const { status, text } = await this.request('GET', '/api/v2/server');
    if (status === 401 || status === 403) throw new ProvisioningError('The Plesk server refused our API key.', false);
    if (status !== 200) throw new ProvisioningError(`The Plesk server answered HTTP ${status}. Check that its REST API is enabled.`, status >= 500);
    const info = JSON.parse(text || '{}') as { hostname?: string; panel_version?: string };
    return `Plesk ${info.panel_version ?? ''}${info.hostname ? ` on ${info.hostname}` : ''}`.trim();
  }

  /** The login of the customer owning the domain's subscription, '' if it has no customer owner, or null if there is none. */
  private async subscriptionOwner(domain: string): Promise<string | null> {
    try {
      const r = await this.cli('subscription', ['--info', domain]);
      return /Owner's contact name:\s*.*\((\S+)\)/i.exec(r.stdout)?.[1] ?? /Owner(?:'s)? login:\s*(\S+)/i.exec(r.stdout)?.[1] ?? '';
    } catch (e) {
      if (e instanceof ProvisioningError && e.notFound) return null;
      throw e;
    }
  }

  /** One command-line tool call. `harmless` is what Plesk says when it is already as asked. `secret` is scrubbed from messages. */
  private async cli(tool: 'customer' | 'subscription', params: string[], secret?: string, harmless?: RegExp): Promise<CliReply> {
    const { status, text } = await this.request('POST', `/api/v2/cli/${tool}/call`, JSON.stringify({ params }));
    if (status === 401 || status === 403) throw new ProvisioningError('The Plesk server refused our API key. Check PLESK_API_KEY.', false);
    if (status === 429 || status >= 500) throw new ProvisioningError(`The Plesk server is not available right now (HTTP ${status}).`, true);
    if (status !== 200) throw new ProvisioningError(`The Plesk server answered with an unexpected status (HTTP ${status}). Check that its REST API is enabled.`, false);
    let reply: CliReply;
    try {
      reply = JSON.parse(text) as CliReply;
    } catch {
      throw new ProvisioningError('The Plesk server sent a reply we could not read. Check the host and port (usually 8443).', false);
    }
    if (reply.code === 0) return reply;
    const raw = `${reply.stderr || reply.stdout || 'Plesk refused the request.'}`.replace(/\s+/g, ' ').trim();
    if (harmless?.test(raw)) return reply;
    const reason = (secret ? raw.split(secret).join('***') : raw).slice(0, 300);
    const err = new ProvisioningError(reason, BUSY.test(raw));
    err.notFound = NOT_FOUND.test(raw);
    throw err;
  }

  private request(method: 'GET' | 'POST', path: string, body = ''): Promise<{ status: number; text: string }> {
    const useTls = this.cfg.tls !== 'off';
    const lib = useTls ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request(
        {
          host: this.cfg.host, port: this.cfg.port, path, method, timeout: this.timeoutMs,
          headers: { 'X-API-Key': this.cfg.apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Accept: 'application/json' },
          ...(useTls ? { rejectUnauthorized: this.cfg.tls === 'verify' } : {}),
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > MAX_BODY) return req.destroy(new Error('reply too large'));
            chunks.push(c);
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
        },
      );
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
      req.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code && CERT_ERRORS.has(e.code)) reject(new ProvisioningError("The Plesk server's security certificate could not be verified. Install a valid certificate, or set PLESK_TLS=skip.", false));
        else if (e.code === 'ETIMEDOUT') reject(new ProvisioningError('The Plesk server did not answer in time.', true));
        else reject(new ProvisioningError(`The Plesk server could not be reached (${e.code ?? e.message}).`, true));
      });
      req.end(body);
    });
  }
}
