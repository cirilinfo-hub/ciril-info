import type { CreateAccountResult, HostingProvider } from './hosting-provider.js';

/**
 * Manual mode: no hosting panel is connected, so people do the work. The queue never calls these methods; it turns
 * each job into a task for staff instead. They exist so a mistake fails loudly rather than silently doing nothing.
 */
export class ManualHostingProvider implements HostingProvider {
  readonly id = 'MANUAL' as const;
  readonly mode = 'manual' as const;

  private never(): never {
    throw new Error('Manual hosting does not call a panel: tasks are completed by staff.');
  }
  async createAccount(): Promise<CreateAccountResult> {
    return this.never();
  }
  async suspend(): Promise<void> {
    this.never();
  }
  async unsuspend(): Promise<void> {
    this.never();
  }
  async changePackage(): Promise<void> {
    this.never();
  }
  async terminate(): Promise<void> {
    this.never();
  }
}
