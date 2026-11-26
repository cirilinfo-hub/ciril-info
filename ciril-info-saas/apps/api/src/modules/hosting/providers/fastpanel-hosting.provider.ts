import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { type CreateAccountRequest, type CreateAccountResult, type HostingProvider, type PanelLogin, ProvisioningError } from './hosting-provider.js';

export interface FastpanelConfig {
  host: string;
  /** FASTPANEL's port, 8888 by default. */
  port: number;
  /**
   * An API token with full scope, made on the panel server with
   * `mogwai users tokens add --name cirilinfo --scopes full --constraint <this app's server IP>`. Sent as a Bearer token.
   */
  token: string;
  /** verify: normal HTTPS. skip: HTTPS without checking the certificate (a fresh panel's self-signed one). off: plain HTTP, tests only. */
  tls: 'verify' | 'skip' | 'off';
  /** The server's shared IPv4 address, which new websites listen on. */
  ip: string;
  /** PHP version for new websites, without the dot (FASTPANEL's form): "83" for PHP 8.3. */
  phpVersion?: string;
  timeoutMs?: number;
  /** How long to wait for FASTPANEL to finish creating or changing a user before trying again later. */
  settleMs?: number;
  pollMs?: number;
}

interface FpUser { id: number; username: string; roles: string[]; enabled: boolean; action: string | null; quota: number | null }
interface FpSite { id: number; domain: string; owner?: { id: number; username: string } | null }
interface FpTemplate { id: number; name: string }

const CERT_ERRORS = new Set(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);
const MAX_BODY = 5_000_000;
/** Users we must never change or remove: the panel's own administrators. */
const PROTECTED_ROLES = /SUPER_ADMIN|RESELLER/;

/**
 * Creates and manages hosting on a FASTPANEL server through its HTTP API (the same API its own web interface uses). Each
 * hosting account is a FASTPANEL user named like the panel username, holding the website for the domain. The plan's panel
 * package is the name of a FASTPANEL limit template (sites, databases, mailboxes...), and its disk size is set as the user's
 * disk quota, which FASTPANEL enforces once its Quota application is installed.
 *
 * FASTPANEL does not email customers their login, so the app shows it in the client area instead (resetPanelLogin).
 *
 * Calls are safe to repeat: a retry finds the user or website it made before, and suspending, restoring or removing
 * something already in that state is a success. A timeout, a refused connection or a busy panel can be retried; anything
 * else goes to staff with FASTPANEL's own words. Mapped and checked against FASTPANEL 8.0 (Ubuntu 24.04).
 */
export class FastpanelHostingProvider implements HostingProvider {
  readonly id = 'FASTPANEL' as const;
  readonly mode = 'automatic' as const;
  private readonly timeoutMs: number;
  private readonly settleMs: number;
  private readonly pollMs: number;

  constructor(private readonly cfg: FastpanelConfig) {
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.settleMs = cfg.settleMs ?? 90_000;
    this.pollMs = cfg.pollMs ?? 2_000;
  }

  async createAccount(req: CreateAccountRequest): Promise<CreateAccountResult> {
    if (!req.packageName) {
      throw new ProvisioningError('This plan has no panel package set (the name of a FASTPANEL limit template). An admin needs to set one.', false);
    }
    const templateId = await this.templateId(req.packageName);

    const site = await this.findSite(req.domain);
    if (site && site.owner?.username !== req.username) {
      throw new ProvisioningError(`${req.domain} already exists on the FASTPANEL server under another user.`, false);
    }

    let user = await this.findUser(req.username);
    if (user && PROTECTED_ROLES.test(user.roles.join(','))) {
      throw new ProvisioningError(`The username ${req.username} belongs to a FASTPANEL administrator. Choose another one.`, false);
    }
    if (!user) {
      const password = newPassword();
      const r = await this.call('POST', '/api/users', { username: req.username, password, roles: 'ROLE_USER', quota: quotaKb(req.diskQuotaMb) }, password, /already exists/i);
      user = r.status === 400 ? await this.findUser(req.username) : (r.data as FpUser);
      if (!user) throw new ProvisioningError(`FASTPANEL said the user ${req.username} exists, but it could not be found.`, true);
    }
    await this.settle(user.id);
    await this.applyPlan(user.id, templateId, req.diskQuotaMb);

    if (!site) {
      // FASTPANEL checks the name first: an email or DNS zone for it left behind elsewhere would clash.
      const probe = await this.call('POST', '/api/master/domain', { domain: req.domain, aliases: [{ name: `www.${req.domain}` }] });
      const clash = probe.data as Record<string, unknown> | null;
      if (clash && Object.values(clash).some(Boolean)) {
        throw new ProvisioningError(`FASTPANEL already has an email or DNS zone for ${req.domain}. Remove it on the panel, then retry.`, false);
      }
      await this.call('PUT', '/api/master', {
        domain: req.domain, aliases: [{ name: `www.${req.domain}` }], ips: [{ ip: this.cfg.ip }], owner: user.id, user: null,
        email_domain: false, dns_domain: null, ssh_access: null, database: null, ftp_account: null, sftp_account: null, backup_plan_id: null,
        type: 'php', handler: 'php_fpm', handler_version: this.cfg.phpVersion ?? '83',
      }, undefined, /already exists/i);
    }
    return { panelUsername: req.username, serverName: this.cfg.host };
  }

  async suspend(req: { panelUsername: string; domain: string; reason: string }): Promise<void> {
    await this.setEnabled(req.panelUsername, false);
  }

  async unsuspend(req: { panelUsername: string; domain: string }): Promise<void> {
    await this.setEnabled(req.panelUsername, true);
  }

  async changePackage(req: { panelUsername: string; domain: string; packageName: string; diskQuotaMb?: number | null }): Promise<void> {
    const user = await this.customer(req.panelUsername);
    await this.applyPlan(user.id, await this.templateId(req.packageName), req.diskQuotaMb);
  }

  async terminate(req: { panelUsername: string; domain: string }): Promise<void> {
    const user = await this.findUser(req.panelUsername);
    if (!user) return; // already gone
    if (PROTECTED_ROLES.test(user.roles.join(','))) throw new ProvisioningError(`Refusing to remove ${req.panelUsername}: it is a FASTPANEL administrator.`, false);
    // Removing the user removes its websites, mail, databases, files and system account with it.
    await this.call('DELETE', `/api/users/${user.id}`, undefined, undefined, undefined, true);
  }

  async resetPanelLogin(req: { panelUsername: string; domain: string }): Promise<PanelLogin> {
    const user = await this.customer(req.panelUsername);
    const password = newPassword();
    await this.call('PUT', `/api/users/${user.id}`, { password }, password);
    return { url: `https://${this.cfg.host}:${this.cfg.port}/`, username: user.username, password };
  }

  async ping(): Promise<string> {
    const me = (await this.call('GET', '/api/me')).data as FpUser;
    if (!me.roles?.some((r) => r.includes('SUPER_ADMIN'))) {
      throw new ProvisioningError(`The API token belongs to ${me.username}, not to a FASTPANEL administrator. Make the token as the panel's admin user.`, false);
    }
    const s = (await this.call('GET', '/api/settings')).data as { panel_version?: string; limits?: boolean; configuration?: { quota?: { status?: number } } };
    const notes = [
      s.limits ? 'limits on' : 'LIMITS OFF: turn them on in FASTPANEL settings, or plans cannot be applied',
      s.configuration?.quota?.status ? 'disk quotas on' : 'DISK QUOTAS OFF: install the Quota application in FASTPANEL, or disk sizes are not enforced',
    ];
    return `FASTPANEL ${s.panel_version ?? ''} (${notes.join('; ')})`.replace(/\s+\(/, ' (');
  }

  private async setEnabled(username: string, enabled: boolean) {
    const user = await this.customer(username);
    if (user.enabled === enabled) return;
    await this.call('PUT', `/api/users/${user.id}/status`, { enabled });
    await this.settle(user.id);
  }

  /** The plan's limit template, then its disk size. */
  private async applyPlan(userId: number, templateId: number, diskQuotaMb: number | null | undefined) {
    const r = await this.call('PUT', `/api/limits/${userId}`, { template_id: templateId });
    if ((r.data as { template_id?: number } | null)?.template_id !== templateId) {
      throw new ProvisioningError('FASTPANEL did not apply the plan’s limit template.', true);
    }
    if (diskQuotaMb) {
      await this.call('PUT', `/api/users/${userId}`, { quota: quotaKb(diskQuotaMb) });
      await this.settle(userId);
    }
  }

  /** An existing customer user, or a clear error. */
  private async customer(username: string): Promise<FpUser> {
    const user = await this.findUser(username);
    if (!user) {
      const err = new ProvisioningError(`There is no user ${username} on the FASTPANEL server.`, false);
      err.notFound = true;
      throw err;
    }
    if (PROTECTED_ROLES.test(user.roles.join(','))) throw new ProvisioningError(`${username} is a FASTPANEL administrator, not a customer.`, false);
    return user;
  }

  private async findUser(username: string): Promise<FpUser | null> {
    const users = (await this.call('GET', '/api/users')).data as FpUser[];
    return users.find((u) => u.username === username) ?? null;
  }

  private async findSite(domain: string): Promise<FpSite | null> {
    const sites = (await this.call('GET', `/api/sites/list?${encodeURIComponent('filter[limit]')}=100000&${encodeURIComponent('filter[type]')}=all`)).data as FpSite[];
    return sites.find((s) => s.domain === domain) ?? null;
  }

  private async templateId(name: string): Promise<number> {
    const templates = (await this.call('GET', '/api/limits/templates')).data as FpTemplate[];
    const t = templates.find((x) => x.name === name) ?? templates.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!t) throw new ProvisioningError(`FASTPANEL has no limit template named "${name}". Create it in FASTPANEL, or correct the plan's panel package.`, false);
    return t.id;
  }

  /** FASTPANEL finishes user changes in the background ("action": CREATING, UPDATING...). Waits until it is done. */
  private async settle(userId: number) {
    const until = Date.now() + this.settleMs;
    for (;;) {
      const r = await this.call('GET', `/api/users/${userId}`, undefined, undefined, undefined, true);
      if (r.status === 404 || !(r.data as FpUser).action) return;
      if (Date.now() >= until) throw new ProvisioningError('FASTPANEL is still working on this user. It will be tried again shortly.', true);
      await new Promise((ok) => setTimeout(ok, this.pollMs));
    }
  }

  /**
   * One API call. `secret` is scrubbed from messages; a 400 matching `harmless` is returned rather than thrown (the thing
   * already exists); with `allowNotFound` a 404 is returned too.
   */
  private async call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, secret?: string, harmless?: RegExp, allowNotFound = false): Promise<{ status: number; data: unknown }> {
    const { status, text } = await this.request(method, path, body === undefined ? '' : JSON.stringify(body));
    if (status === 401 || status === 403) throw new ProvisioningError('The FASTPANEL server refused our API token. Check it in Admin > Hosting servers.', false);
    if (status === 429 || status >= 500) throw new ProvisioningError(`The FASTPANEL server is not available right now (HTTP ${status}).`, true);
    let json: { data?: unknown; errors?: unknown } = {};
    try {
      json = text ? (JSON.parse(text) as typeof json) : {};
    } catch {
      if (status === 404 && allowNotFound) return { status, data: null };
      throw new ProvisioningError(`The FASTPANEL server sent a reply we could not read (HTTP ${status}). Check the host and port (usually 8888).`, false);
    }
    if (status === 404) {
      if (allowNotFound) return { status, data: null };
      const err = new ProvisioningError(`FASTPANEL could not find ${path.replace(/\?.*/, '')}.`, false);
      err.notFound = true;
      throw err;
    }
    if (status >= 400) {
      const raw = describe(json.errors) || `FASTPANEL refused the request (HTTP ${status}).`;
      if (harmless?.test(raw)) return { status, data: null };
      const message = (secret ? raw.split(secret).join('***') : raw).replace(/\s+/g, ' ').trim().slice(0, 300);
      if (/limits?.*disabled/i.test(raw)) throw new ProvisioningError('Limits are switched off on the FASTPANEL server. Turn them on in its settings, then retry.', false);
      throw new ProvisioningError(message, false);
    }
    return { status, data: json.data ?? null };
  }

  private request(method: string, path: string, body: string): Promise<{ status: number; text: string }> {
    const useTls = this.cfg.tls !== 'off';
    const lib = useTls ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request(
        {
          // A fresh connection each time: FASTPANEL closes idle keep-alive connections, and reusing one fails with ECONNRESET.
          host: this.cfg.host, port: this.cfg.port, path, method, timeout: this.timeoutMs, agent: false,
          headers: {
            Authorization: `Bearer ${this.cfg.token}`, Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
          },
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
        if (e.code && CERT_ERRORS.has(e.code)) reject(new ProvisioningError("The FASTPANEL server's security certificate could not be verified. Install a valid certificate for the panel, or set its TLS check to skip.", false));
        else if (e.code === 'ETIMEDOUT') reject(new ProvisioningError('The FASTPANEL server did not answer in time.', true));
        else reject(new ProvisioningError(`The FASTPANEL server could not be reached (${e.code ?? e.message}).`, true));
      });
      req.end(body || undefined);
    });
  }
}

/** FASTPANEL wants at least 8 characters; this is long, random and has every character class. */
function newPassword() {
  return `${randomBytes(18).toString('base64url')}-Aa9`;
}

/** Disk quota in kilobytes, as FASTPANEL takes it. 0 means no limit. */
function quotaKb(mb: number | null | undefined) {
  return mb && mb > 0 ? Math.round(mb * 1024) : 0;
}

/** FASTPANEL's errors are a sentence, or field → sentence. */
function describe(errors: unknown): string {
  if (!errors) return '';
  if (typeof errors === 'string') return errors;
  if (typeof errors === 'object') return Object.entries(errors as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join('; ');
  return String(errors);
}
