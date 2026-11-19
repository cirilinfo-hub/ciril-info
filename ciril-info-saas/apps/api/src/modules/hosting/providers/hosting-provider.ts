/**
 * The boundary between our hosting code and a hosting control panel (cPanel/WHM, Plesk). Everything panel-specific
 * lives behind this, so the queue, retries, notices and screens do not change when a real panel is connected.
 */
export type HostingProviderId = 'MOCK' | 'CPANEL' | 'PLESK';

/** A failure with a verdict: a retryable one (timeout, panel busy) is tried again later; any other goes to staff. */
export class ProvisioningError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface CreateAccountRequest {
  domain: string;
  /** Proposed panel username. The panel may refuse it (taken), and the adapter reports that clearly. */
  username: string;
  /** The panel's package name, from the plan. */
  packageName: string | null;
  contactEmail: string;
  /** The same key on a retry must never create a second account. */
  idempotencyKey: string;
  /** 1 for the first try. */
  attempt: number;
}

export interface CreateAccountResult {
  panelUsername: string;
  /** Which server it landed on, when the provider chooses. */
  serverName?: string;
}

export interface HostingProvider {
  readonly id: HostingProviderId;
  createAccount(req: CreateAccountRequest): Promise<CreateAccountResult>;
  suspend(req: { panelUsername: string; reason: string }): Promise<void>;
  unsuspend(req: { panelUsername: string }): Promise<void>;
  changePackage(req: { panelUsername: string; packageName: string }): Promise<void>;
  terminate(req: { panelUsername: string }): Promise<void>;
}
