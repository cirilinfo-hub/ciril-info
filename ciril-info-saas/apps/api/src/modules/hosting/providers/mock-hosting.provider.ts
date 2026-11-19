import { type CreateAccountRequest, type CreateAccountResult, type HostingProvider, ProvisioningError } from './hosting-provider.js';

/**
 * Test mode. Creates nothing anywhere. Refused in production by env validation.
 * Domains ending in particular words let tests (and you) watch every outcome:
 *   .fail.test   the panel refuses it for good (not retryable)
 *   .flaky.test  the panel is "busy" for the first two tries, then works
 *   .slow.test   never succeeds in time (always retryable), to see retries run out
 */
export class MockHostingProvider implements HostingProvider {
  readonly id = 'MOCK' as const;
  readonly mode = 'automatic' as const;
  /** What the pretend panel holds, so repeated calls behave like a real one. */
  readonly accounts = new Map<string, { suspended: boolean; packageName: string | null; terminated: boolean }>();

  async createAccount(req: CreateAccountRequest): Promise<CreateAccountResult> {
    if (req.domain.endsWith('.fail.test')) throw new ProvisioningError('The panel refused this domain.', false);
    if (req.domain.endsWith('.slow.test')) throw new ProvisioningError('The panel did not answer in time.', true);
    if (req.domain.endsWith('.flaky.test') && req.attempt < 3) throw new ProvisioningError('The panel is busy.', true);
    // The same key gives the same username, so a retried create never makes a second account.
    const panelUsername = req.username;
    this.accounts.set(panelUsername, { suspended: false, packageName: req.packageName, terminated: false });
    return { panelUsername, serverName: 'mock-server-1' };
  }

  async suspend(req: { panelUsername: string; reason: string }): Promise<void> {
    const a = this.accounts.get(req.panelUsername);
    if (a) a.suspended = true; // suspending twice is fine, like a real panel
  }

  async unsuspend(req: { panelUsername: string }): Promise<void> {
    const a = this.accounts.get(req.panelUsername);
    if (a) a.suspended = false;
  }

  async changePackage(req: { panelUsername: string; packageName: string }): Promise<void> {
    const a = this.accounts.get(req.panelUsername);
    if (a) a.packageName = req.packageName;
  }

  async terminate(req: { panelUsername: string }): Promise<void> {
    const a = this.accounts.get(req.panelUsername);
    if (a) a.terminated = true;
  }
}
