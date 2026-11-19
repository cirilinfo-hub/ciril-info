import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { type CreateAccountRequest, type CreateAccountResult, type HostingProvider, ProvisioningError } from './hosting-provider.js';

export interface CpanelConfig {
  host: string;
  port: number;
  /** The WHM user the API token belongs to: root, or a reseller. */
  user: string;
  token: string;
  /** verify: normal HTTPS. skip: HTTPS without checking the certificate (a fresh server's self-signed one). off: plain HTTP, tests only. */
  tls: 'verify' | 'skip' | 'off';
  timeoutMs?: number;
}

/** What WHM says when the account is not there. */
const NOT_FOUND = /does not exist|not found|no such|unable to find|invalid user|unknown user/i;
/** What WHM says when it cannot do it right now but would later. */
const BUSY = /busy|try again|locked|temporar|timed? ?out|overload/i;
const CERT_ERRORS = new Set(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);
const MAX_BODY = 1_000_000;

interface WhmReply {
  metadata?: { result?: number; reason?: string };
  data?: { acct?: { user?: string; domain?: string }[] } & Record<string, unknown>;
}

/**
 * Creates and manages hosting accounts through WHM's JSON API (version 1), authenticated with an API token.
 * Every request is a POST with a form body, so account details never sit in a URL or an access log.
 *
 * Calls are safe to repeat: a create for an account that already exists for the same domain is a success, and
 * suspending, restoring or removing something already in that state is too. Failures carry a verdict: a timeout,
 * a refused connection or a panel that says it is busy can be retried; anything else (a wrong token, a package that
 * does not exist, a username that belongs to another account) goes to staff with the panel's own words.
 */
export class CpanelHostingProvider implements HostingProvider {
  readonly id = 'CPANEL' as const;
  readonly mode = 'automatic' as const;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: CpanelConfig) {
    this.timeoutMs = cfg.timeoutMs ?? 20_000;
  }

  async createAccount(req: CreateAccountRequest): Promise<CreateAccountResult> {
    if (!req.packageName) throw new ProvisioningError('This plan has no panel package set. An admin needs to set one.', false);

    const existing = await this.find(req.username);
    if (existing) {
      // A retry of a create that already worked, or a username that really belongs to somebody else.
      if (existing.domain?.toLowerCase() === req.domain.toLowerCase()) return { panelUsername: req.username, serverName: this.cfg.host };
      throw new ProvisioningError(`The panel username "${req.username}" is already used by another account.`, false);
    }

    // The customer receives WHM's own welcome email (sendemail) and can set their own password from it.
    const password = `${randomBytes(18).toString('base64url')}-Aa9`;
    await this.call('createacct', {
      username: req.username, domain: req.domain, plan: req.packageName, contactemail: req.contactEmail, password, sendemail: '1',
    }, password);
    return { panelUsername: req.username, serverName: this.cfg.host };
  }

  async suspend(req: { panelUsername: string; reason: string }): Promise<void> {
    await this.call('suspendacct', { user: req.panelUsername, reason: req.reason.slice(0, 250), 'leave-ftp': '0' }, undefined, /already suspended/i);
  }

  async unsuspend(req: { panelUsername: string }): Promise<void> {
    await this.call('unsuspendacct', { user: req.panelUsername }, undefined, /not suspended|isn't suspended|is not currently suspended/i);
  }

  async changePackage(req: { panelUsername: string; packageName: string }): Promise<void> {
    await this.call('changepackage', { user: req.panelUsername, pkg: req.packageName });
  }

  async terminate(req: { panelUsername: string }): Promise<void> {
    await this.call('removeacct', { user: req.panelUsername, keepdns: '0' }, undefined, NOT_FOUND);
  }

  /** The account, or null when the panel has none by that name. */
  private async find(username: string): Promise<{ user?: string; domain?: string } | null> {
    try {
      const r = await this.call('accountsummary', { user: username });
      return r.data?.acct?.[0] ?? null;
    } catch (e) {
      if (e instanceof ProvisioningError && e.notFound) return null;
      throw e;
    }
  }

  /**
   * One WHM function call. `harmless` is what the panel says when the thing is already as asked, which counts as success.
   * `secret` is scrubbed from any message that could be shown to staff.
   */
  private async call(fn: string, params: Record<string, string>, secret?: string, harmless?: RegExp): Promise<WhmReply> {
    const body = new URLSearchParams({ 'api.version': '1', ...params }).toString();
    const { status, text } = await this.post(`/json-api/${fn}`, body);

    if (status === 401 || status === 403) throw new ProvisioningError('The hosting panel refused our API token. Check the token and its permissions in WHM.', false);
    if (status === 429 || status >= 500) throw new ProvisioningError(`The hosting panel is not available right now (HTTP ${status}).`, true);
    if (status !== 200) throw new ProvisioningError(`The hosting panel answered with an unexpected status (HTTP ${status}).`, false);

    let reply: WhmReply;
    try {
      reply = JSON.parse(text) as WhmReply;
    } catch {
      throw new ProvisioningError('The hosting panel sent a reply we could not read. Check the host, port and that this is a WHM address.', false);
    }
    if (reply.metadata?.result === 1) return reply;

    const raw = (reply.metadata?.reason ?? 'The panel refused the request.').replace(/\s+/g, ' ').trim();
    const reason = (secret ? raw.split(secret).join('***') : raw).slice(0, 300);
    if (harmless?.test(raw)) return reply;
    const err = new ProvisioningError(reason, BUSY.test(raw));
    err.notFound = NOT_FOUND.test(raw);
    throw err;
  }

  private post(path: string, body: string): Promise<{ status: number; text: string }> {
    const useTls = this.cfg.tls !== 'off';
    const lib = useTls ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request(
        {
          host: this.cfg.host, port: this.cfg.port, path, method: 'POST', timeout: this.timeoutMs,
          headers: { Authorization: `whm ${this.cfg.user}:${this.cfg.token}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), Accept: 'application/json' },
          ...(useTls ? { rejectUnauthorized: this.cfg.tls === 'verify' } : {}),
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > MAX_BODY) {
              req.destroy(new Error('reply too large'));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
        },
      );
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
      req.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code && CERT_ERRORS.has(e.code)) {
          reject(new ProvisioningError("The hosting panel's security certificate could not be verified. Install a valid certificate on the server, or set CPANEL_TLS=skip.", false));
        } else if (e.code === 'ETIMEDOUT') {
          reject(new ProvisioningError('The hosting panel did not answer in time.', true));
        } else {
          reject(new ProvisioningError(`The hosting panel could not be reached (${e.code ?? e.message}).`, true));
        }
      });
      req.end(body);
    });
  }
}
