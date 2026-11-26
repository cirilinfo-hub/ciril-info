/**
 * The boundary between our hosting code and a hosting control panel (cPanel/WHM, Plesk). Everything panel-specific
 * lives behind this, so the queue, retries, notices and screens do not change when a real panel is connected.
 */
export type HostingProviderId = 'MOCK' | 'MANUAL' | 'CPANEL' | 'PLESK' | 'FASTPANEL' | 'SERVERS';

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
  /** Our hosting account. With several servers it says which server the account lives on. */
  accountId?: string;
  domain: string;
  /** Proposed panel username. The panel may refuse it (taken), and the adapter reports that clearly. */
  username: string;
  /** The panel's package name, from the plan. */
  packageName: string | null;
  /**
   * The plan's disk space in MB (its "disk_gb" limit), for panels whose packages carry no disk size (FASTPANEL sets it on
   * the user). Null: no limit given. cPanel and Plesk ignore it: their package holds the disk size.
   */
  diskQuotaMb?: number | null;
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
  suspend(req: { accountId?: string; panelUsername: string; domain: string; reason: string }): Promise<void>;
  unsuspend(req: { accountId?: string; panelUsername: string; domain: string }): Promise<void>;
  changePackage(req: { accountId?: string; panelUsername: string; domain: string; packageName: string; diskQuotaMb?: number | null }): Promise<void>;
  terminate(req: { accountId?: string; panelUsername: string; domain: string }): Promise<void>;
  /** A harmless call that proves the panel answers and accepts our credentials. Returns what the panel says it is. */
  ping?(): Promise<string>;
  /**
   * Sets a new random password for the customer's panel login and returns it, with where to sign in. Only for panels that
   * do not email customers their login themselves (FASTPANEL); cPanel and Plesk send their own welcome email instead.
   */
  resetPanelLogin?(req: { accountId?: string; panelUsername: string; domain: string }): Promise<PanelLogin>;
}

/** A customer's control panel login, shown to them once. */
export interface PanelLogin {
  url: string;
  username: string;
  password: string;
}
