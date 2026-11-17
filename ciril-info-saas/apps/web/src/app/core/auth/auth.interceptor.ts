import { type HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

const isApi = (req: HttpRequest<unknown>, api: string) => req.url.startsWith(api);
const isAuthCall = (req: HttpRequest<unknown>, api: string) =>
  /\/auth\/(login|refresh|mfa\/verify|register|forgot-password|reset-password|verify-email|resend-verification|setup-account)/.test(req.url.slice(api.length));

/**
 * Portal-scoped interceptor:
 *  - adds the in-memory access token, the anti-CSRF header and the selected organisation
 *  - refreshes the token shortly before expiry
 *  - on 401, refreshes once and retries; if that fails, the session has ended
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  if (!isApi(req, auth.api)) return next(req);

  const decorate = (r: HttpRequest<unknown>) => {
    const headers: Record<string, string> = { 'X-Requested-With': 'cirilinfo' };
    const token = auth.token();
    if (token && !isAuthCall(r, auth.api)) headers['Authorization'] = `Bearer ${token}`;
    const tenant = auth.tenantId();
    if (tenant && auth.portal === 'customer') headers['X-Tenant-Id'] = tenant;
    return r.clone({ setHeaders: headers, withCredentials: r.url.includes('/auth/') });
  };

  if (isAuthCall(req, auth.api)) return next(decorate(req));

  const send = () => next(decorate(req));
  const pre = auth.token() && auth.tokenNeedsRefresh() ? from(auth.refresh()).pipe(switchMap(() => send())) : send();

  return pre.pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401) return throwError(() => err);
      return from(auth.refresh()).pipe(
        switchMap((ok) => {
          if (!ok) {
            void auth.sessionEnded();
            return throwError(() => err);
          }
          return send();
        }),
      );
    }),
  );
};
