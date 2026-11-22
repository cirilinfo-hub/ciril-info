/**
 * The boundary between our hosting code and a hosting control panel (cPanel/WHM, Plesk). Everything panel-specific
 * lives behind this, so the queue, retries, notices and screens do not change when a real panel is connected.
 */
export type HostingProviderId = 'MOCK' | 'MANUAL' | 'CPANEL' | 'PLESK';

/** A failure with a verdict: a retryable one (timeout, panel busy) is tried again later; any other goes to staff. */
export class ProvisioningError extends Error {
  /** Set by an adapter when the panel said the account does not exist, so a caller can treat that as an answer. */
  notFound = false;

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
  /** automatic: we call the panel. manual: a person does it and tells us. */
  readonly mode: 'automatic' | 'manual';
  createAccount(req: CreateAccountRequest): Promise<CreateAccountResult>;
  // The domain is passed too: some panels (Plesk) name an account by its domain rather than its username.
  suspend(req: { panelUsername: string; domain: string; reason: string }): Promise<void>;
  unsuspend(req: { panelUsername: string; domain: string }): Promise<void>;
  changePackage(req: { panelUsername: string; domain: string; packageName: string }): Promise<void>;
  terminate(req: { panelUsername: string; domain: string }): Promise<void>;
}
