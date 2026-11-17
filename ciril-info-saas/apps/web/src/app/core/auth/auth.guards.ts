import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * UI routing only. These guards decide which screen to show; every API call is
 * still authorised by the server (AuthGuard / TenantGuard / PostgreSQL RLS).
 */

/** Signed-in area. Sends incomplete sign-ins to the required step (password change, MFA setup). */
export const requireSession: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const ok = auth.isSignedIn() || (await auth.restore());
  if (!ok) return router.createUrlTree([auth.link('/login')], { queryParams: { returnUrl: state.url } });
  const step = auth.next();
  if (step === 'PASSWORD_CHANGE') return router.createUrlTree([auth.link('/change-password')]);
  if (step === 'MFA_SETUP') return router.createUrlTree([auth.link('/security/two-step')]);
  return true;
};

/** For the forced steps themselves: must be signed in, but incomplete is fine. */
export const requireAnySession: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const ok = auth.isSignedIn() || (await auth.restore());
  return ok || router.createUrlTree([auth.link('/login')]);
};

/** Sign-in pages: skip them if a complete session already exists. */
export const redirectIfSignedIn: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const ok = auth.isSignedIn() || (await auth.restore());
  return ok && auth.next() === 'NONE' ? router.createUrlTree([auth.link('/')]) : true;
};

/** Hide screens the user's role cannot use (the API enforces the same rule). */
export const requirePermission =
  (...perms: string[]): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    return perms.every((p) => auth.can(p)) || router.createUrlTree([auth.link('/')], { queryParams: { denied: 1 } });
  };
