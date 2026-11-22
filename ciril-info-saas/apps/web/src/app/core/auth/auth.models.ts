import { InjectionToken } from '@angular/core';

export type Portal = 'customer' | 'admin';

/** Which portal this route tree belongs to (provided per lazy-loaded portal). */
export const PORTAL = new InjectionToken<Portal>('PORTAL');

/** URL prefix of the portal inside this SPA: '' on app./admin. hosts, '/portal' or '/admin' locally. */
export const PORTAL_BASE = new InjectionToken<string>('PORTAL_BASE');

export type NextStep = 'NONE' | 'MFA_SETUP' | 'PASSWORD_CHANGE';

export type LoginResponse =
  | { status: 'OK'; accessToken: string; expiresIn: number; next: NextStep }
  | { status: 'MFA_REQUIRED'; mfaToken: string };

export interface Membership {
  tenant: { id: string; name: string; slug: string; status: string };
  role: { key: string; name: string };
  permissions: string[];
}

export interface Me {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    emailVerified: boolean;
    mfaEnabled: boolean;
    recoveryCodesLeft: number;
    lastLoginAt: string | null;
    createdAt: string;
  };
  session: { portal: Portal; mfaVerified: boolean; mustChangePassword: boolean };
  platform: { role: { key: string; name: string }; permissions: string[] } | null;
  memberships: Membership[];
}
