export type Availability = 'AVAILABLE' | 'TAKEN' | 'UNKNOWN';

/**
 * What the site needs from a domain registrar. Every adapter can search. Adapters for a connected registrar also have
 * `automation`, so paid registrations, renewals and transfers are placed without staff; without it, each one becomes a task for
 * staff, who do it by hand at the registrar. Adapters never throw for "taken" when searching: they return TAKEN. They may throw
 * when the registrar cannot be reached, and the caller then shows UNKNOWN.
 */
export interface RegistrarProvider {
  readonly id: 'MOCK' | string;
  /** Availability of fully qualified names such as "acme.com". */
  checkAvailability(domains: string[]): Promise<Record<string, Availability>>;
  readonly automation?: RegistrarAutomation;
}

/** The person or business a domain is registered to. The registrar publishes or keeps this as the legal owner. */
export interface RegistrantContact {
  firstName: string;
  lastName: string;
  organisation?: string;
  email: string;
  /** As typed by the customer, for example "+91 98765 43210". The adapter formats it for the registrar. */
  phone: string;
  address1: string;
  address2?: string;
  city: string;
  /** Full state name, for example "Maharashtra". */
  state: string;
  postalCode: string;
  /** Two letters, for example "IN". */
  country: string;
}

/** The customer's agreement to the registration terms: where and when they placed the order. */
export interface RegistrationConsent {
  ip: string;
  at: Date;
}

export interface RegisteredDomain {
  /** The registrar's own reference (an order or domain id), kept for staff. */
  ref: string | null;
  /** The end date the registrar reports, when it says. */
  expiresAt: Date | null;
}

export interface RegistrarDomainInfo {
  /** ACTIVE: in our account and usable. PENDING: in our account but not finished (for example a transfer still going). */
  state: 'ACTIVE' | 'PENDING' | 'OTHER';
  expiresAt: Date | null;
  ref: string | null;
}

export interface RegistrarAutomation {
  /** The domain as it is in our registrar account, or null when the account does not hold it. */
  info(domain: string): Promise<RegistrarDomainInfo | null>;
  register(req: { domain: string; years: number; registrant: RegistrantContact; consent: RegistrationConsent }): Promise<RegisteredDomain>;
  renew(req: { domain: string; years: number }): Promise<RegisteredDomain>;
  /** Starts a transfer in. It finishes days later, when the losing registrar lets go; `info` then shows it ACTIVE. */
  transfer(req: { domain: string; authCode: string; registrant: RegistrantContact; consent: RegistrationConsent }): Promise<{ ref: string | null }>;
}

/**
 * A registrar call that did not work. `retryable` means trying again later may succeed (the registrar was busy or unreachable);
 * otherwise a person has to look at it (the name was taken, the account has no funds, a contact detail was refused). The message
 * is written for staff.
 */
export class RegistrarError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code = 'REGISTRAR_ERROR') {
    super(message);
    this.name = 'RegistrarError';
  }
}
