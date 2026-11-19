import { randomBytes } from 'node:crypto';
import { type CreateAccountRequest, type CreateAccountResult, type HostingProvider, ProvisioningError } from './hosting-provider.js';
import { type CpanelConfig, NOT_FOUND, WhmClient } from './whm-client.js';

export type { CpanelConfig } from './whm-client.js';

/**
 * Creates and manages hosting accounts through WHM's JSON API (version 1), authenticated with an API token.
 *
 * Calls are safe to repeat: a create for an account that already exists for the same domain is a success, and
 * suspending, restoring or removing something already in that state is too. Failures carry a verdict: a timeout,
 * a refused connection or a panel that says it is busy can be retried; anything else (a wrong token, a package that
 * does not exist, a username that belongs to another account) goes to staff with the panel's own words.
 */
export class CpanelHostingProvider implements HostingProvider {
  readonly id = 'CPANEL' as const;
  readonly mode = 'automatic' as const;
  private readonly whm: WhmClient;

  constructor(cfg: CpanelConfig) {
    this.whm = new WhmClient(cfg);
  }

  async createAccount(req: CreateAccountRequest): Promise<CreateAccountResult> {
    if (!req.packageName) throw new ProvisioningError('This plan has no panel package set. An admin needs to set one.', false);

    const existing = await this.find(req.username);
    if (existing) {
      // A retry of a create that already worked, or a username that really belongs to somebody else.
      if (existing.domain?.toLowerCase() === req.domain.toLowerCase()) return { panelUsername: req.username, serverName: this.whm.host };
      throw new ProvisioningError(`The panel username "${req.username}" is already used by another account.`, false);
    }

    // The customer receives WHM's own welcome email (sendemail) and can set their own password from it.
    const password = `${randomBytes(18).toString('base64url')}-Aa9`;
    await this.whm.call('createacct', {
      username: req.username, domain: req.domain, plan: req.packageName, contactemail: req.contactEmail, password, sendemail: '1',
    }, password);
    return { panelUsername: req.username, serverName: this.whm.host };
  }

  async suspend(req: { panelUsername: string; reason: string }): Promise<void> {
    await this.whm.call('suspendacct', { user: req.panelUsername, reason: req.reason.slice(0, 250), 'leave-ftp': '0' }, undefined, /already suspended/i);
  }

  async unsuspend(req: { panelUsername: string }): Promise<void> {
    await this.whm.call('unsuspendacct', { user: req.panelUsername }, undefined, /not suspended|isn't suspended|is not currently suspended/i);
  }

  async changePackage(req: { panelUsername: string; packageName: string }): Promise<void> {
    await this.whm.call('changepackage', { user: req.panelUsername, pkg: req.packageName });
  }

  async terminate(req: { panelUsername: string }): Promise<void> {
    await this.whm.call('removeacct', { user: req.panelUsername, keepdns: '0' }, undefined, NOT_FOUND);
  }

  /** The account, or null when the panel has none by that name. */
  private async find(username: string): Promise<{ user?: string; domain?: string } | null> {
    try {
      const r = await this.whm.call('accountsummary', { user: username });
      return (r.data?.['acct'] as { user?: string; domain?: string }[] | undefined)?.[0] ?? null;
    } catch (e) {
      if (e instanceof ProvisioningError && e.notFound) return null;
      throw e;
    }
  }
}
