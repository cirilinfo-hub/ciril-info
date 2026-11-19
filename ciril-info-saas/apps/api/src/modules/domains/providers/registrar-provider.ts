export type Availability = 'AVAILABLE' | 'TAKEN' | 'UNKNOWN';

/**
 * What the site needs from a domain registrar. Searching is the only thing built so far; registering, renewing, transferring
 * and DNS are added to this interface when the real registrar is chosen. Adapters never throw for "taken": they return TAKEN.
 * They may throw when the registrar cannot be reached, and the caller then shows UNKNOWN.
 */
export interface RegistrarProvider {
  readonly id: 'MOCK' | string;
  /** Availability of fully qualified names such as "acme.com". */
  checkAvailability(domains: string[]): Promise<Record<string, Availability>>;
}
