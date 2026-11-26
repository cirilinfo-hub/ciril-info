import type { PlatformPrisma } from '../../../database/prisma-clients.js';
import type { SecretBox } from '../../../common/security/crypto.js';
import type { HostingPanel } from '../../../generated/prisma/client.js';
import { CpanelHostingProvider } from './cpanel-hosting.provider.js';
import { FastpanelHostingProvider } from './fastpanel-hosting.provider.js';
import { type CreateAccountRequest, type CreateAccountResult, type HostingProvider, ProvisioningError } from './hosting-provider.js';
import { PleskHostingProvider } from './plesk-hosting.provider.js';

/** A server's connection details as stored (credentials decrypted on use only). */
export interface ServerRow {
  id: string;
  name: string;
  hostname: string;
  ipAddress: string;
  panel: HostingPanel;
  port: number | null;
  username: string | null;
  tls: string;
  credentialsEnc: string | null;
  updatedAt: Date;
}

export const serverSecretContext = (id: string) => `hosting-server:${id}`;

/** The adapter for one server, built from its stored details. */
export function providerForServer(s: ServerRow, box: SecretBox): HostingProvider {
  if (!s.credentialsEnc) throw new ProvisioningError(`The server ${s.name} has no API credentials saved. Add them in Admin > Hosting servers.`, false);
  const secret = box.decrypt(s.credentialsEnc, serverSecretContext(s.id));
  const tls = (['verify', 'skip', 'off'].includes(s.tls) ? s.tls : 'verify') as 'verify' | 'skip' | 'off';
  if (s.panel === 'CPANEL') return new CpanelHostingProvider({ host: s.hostname, port: s.port ?? 2087, user: s.username || 'root', token: secret, tls });
  if (s.panel === 'PLESK') return new PleskHostingProvider({ host: s.hostname, port: s.port ?? 8443, apiKey: secret, tls, ip: s.ipAddress });
  if (s.panel === 'FASTPANEL') return new FastpanelHostingProvider({ host: s.hostname, port: s.port ?? 8888, token: secret, tls, ip: s.ipAddress });
  throw new ProvisioningError(`The server ${s.name} uses a panel we cannot drive.`, false);
}

/** Panels we can drive (MOCK is for tests only). */
const DRIVABLE: HostingPanel[] = ['CPANEL', 'PLESK', 'FASTPANEL'];
const PANEL_NAME: Record<HostingPanel, string> = { CPANEL: 'cPanel', PLESK: 'Plesk', FASTPANEL: 'FASTPANEL', MOCK: 'test' };

const serverSelect = { id: true, name: true, hostname: true, ipAddress: true, panel: true, port: true, username: true, tls: true, credentialsEnc: true, updatedAt: true, maxAccounts: true } as const;

/**
 * HOSTING_PROVIDER=servers: hosting accounts spread over the servers listed in Admin > Hosting servers (cPanel and Plesk
 * side by side). A new account goes to the active server with the most room (fewest live accounts for its size), limited
 * to the plan's panel type when the plan has one; it is recorded on the account before the panel is called, so a retry
 * goes to the same server. Every later action goes to the server the account lives on.
 */
export class ServersHostingProvider implements HostingProvider {
  readonly id = 'SERVERS' as const;
  readonly mode = 'automatic' as const;
  private readonly cache = new Map<string, { at: number; provider: HostingProvider }>();

  constructor(
    private readonly db: PlatformPrisma,
    private readonly box: SecretBox,
  ) {}

  async createAccount(req: CreateAccountRequest): Promise<CreateAccountResult> {
    const server = await this.serverFor(req.accountId, true);
    const r = await this.adapter(server).createAccount(req);
    return { panelUsername: r.panelUsername, serverName: server.name };
  }
  async suspend(req: { accountId?: string; panelUsername: string; domain: string; reason: string }) {
    await this.adapter(await this.serverFor(req.accountId, false)).suspend(req);
  }
  async unsuspend(req: { accountId?: string; panelUsername: string; domain: string }) {
    await this.adapter(await this.serverFor(req.accountId, false)).unsuspend(req);
  }
  async changePackage(req: { accountId?: string; panelUsername: string; domain: string; packageName: string; diskQuotaMb?: number | null }) {
    await this.adapter(await this.serverFor(req.accountId, false)).changePackage(req);
  }
  async terminate(req: { accountId?: string; panelUsername: string; domain: string }) {
    await this.adapter(await this.serverFor(req.accountId, false)).terminate(req);
  }
  async resetPanelLogin(req: { accountId?: string; panelUsername: string; domain: string }) {
    const adapter = this.adapter(await this.serverFor(req.accountId, false));
    if (!adapter.resetPanelLogin) throw new ProvisioningError('This server’s panel emails customers their own login, so it cannot be shown here.', false);
    return adapter.resetPanelLogin(req);
  }

  /** The account's server; for a new account with none yet, the one with the most room, saved on the account first. */
  private async serverFor(accountId: string | undefined, choose: boolean): Promise<ServerRow> {
    if (!accountId) throw new ProvisioningError('No hosting account was given.', false);
    const account = await this.db.hostingAccount.findUnique({ where: { id: accountId }, select: { serverId: true, plan: { select: { hostingPanel: true } } } });
    if (!account) throw new ProvisioningError('The hosting account no longer exists.', false);
    if (!account.serverId) {
      if (!choose) throw new ProvisioningError('This account was never placed on a server.', false);
      const picked = await this.pick(account.plan.hostingPanel);
      // Only if still unplaced: two tries at once agree on one server.
      await this.db.hostingAccount.updateMany({ where: { id: accountId, serverId: null }, data: { serverId: picked } });
    }
    const placed = await this.db.hostingAccount.findUniqueOrThrow({ where: { id: accountId }, select: { server: { select: serverSelect } } });
    if (!placed.server) throw new ProvisioningError('This account was never placed on a server.', false);
    return placed.server;
  }

  private async pick(panel: HostingPanel | null): Promise<string> {
    const servers = await this.db.hostingServer.findMany({
      where: { status: 'ACTIVE', panel: panel ? panel : { in: DRIVABLE }, credentialsEnc: { not: null } },
      select: { id: true, name: true, maxAccounts: true, _count: { select: { accounts: { where: { status: { in: ['PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDED'] } } } } } },
    });
    const withRoom = servers
      .map((s) => ({ id: s.id, used: s._count.accounts, max: Math.max(1, s.maxAccounts) }))
      .filter((s) => s.used < s.max)
      .sort((a, b) => a.used / a.max - b.used / b.max || a.used - b.used);
    if (!withRoom.length) {
      throw new ProvisioningError(
        servers.length
          ? `Every active${panel ? ` ${PANEL_NAME[panel]}` : ''} server is full. Add a server or raise a server's account limit in Admin > Hosting servers, then retry.`
          : `There is no active${panel ? ` ${PANEL_NAME[panel]}` : ''} server with API credentials. Add one in Admin > Hosting servers, then retry.`,
        false,
      );
    }
    return withRoom[0]!.id;
  }

  private adapter(s: ServerRow): HostingProvider {
    const hit = this.cache.get(s.id);
    if (hit && hit.at === s.updatedAt.getTime()) return hit.provider;
    const provider = providerForServer(s, this.box);
    this.cache.set(s.id, { at: s.updatedAt.getTime(), provider });
    return provider;
  }
}
