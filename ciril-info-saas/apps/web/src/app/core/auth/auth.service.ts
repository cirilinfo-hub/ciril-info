import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { RUNTIME_CONFIG } from '../config/runtime-config';
import { type LoginResponse, type Me, type NextStep, PORTAL, PORTAL_BASE } from './auth.models';

const TENANT_KEY = (portal: string, userId: string) => `ci.tenant.${portal}.${userId}`;

/**
 * Session state for ONE portal. The access token lives only in memory (never
 * localStorage); the refresh token is an httpOnly cookie the browser sends to
 * /api/v1/auth/refresh. On page load we restore the session with one refresh call.
 *
 * Authorisation is always enforced by the API; this service only shapes the UI.
 */
@Injectable()
export class AuthService {
  readonly portal = inject(PORTAL);
  readonly base = inject(PORTAL_BASE);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  readonly api = `${RUNTIME_CONFIG.apiBaseUrl}/api/v1`;

  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshing: Promise<boolean> | null = null;
  private restored: Promise<boolean> | null = null;

  readonly me = signal<Me | null>(null);
  readonly next = signal<NextStep>('NONE');
  readonly tenantId = signal<string | null>(null);

  readonly isSignedIn = computed(() => this.me() !== null);
  readonly currentMembership = computed(() => this.me()?.memberships.find((m) => m.tenant.id === this.tenantId()) ?? null);
  readonly permissions = computed(() => new Set(this.me()?.platform?.permissions ?? this.currentMembership()?.permissions ?? []));

  can(permission: string): boolean {
    return this.permissions().has(permission);
  }

  /** Path inside this portal, e.g. link('/login') → '/portal/login' locally, '/login' on app.cirilinfo.com. */
  link(path: string): string {
    // The portal root is "/portal" (not "/portal/": a trailing slash adds an empty URL segment that no route matches).
    if (path === '/' || path === '') return this.base || '/';
    return `${this.base}${path}`;
  }

  token(): string | null {
    return this.accessToken;
  }

  tokenNeedsRefresh(): boolean {
    return !this.accessToken || Date.now() > this.expiresAt - 30_000;
  }

  // ─── Sign-in flow ───

  async login(email: string, password: string): Promise<LoginResponse> {
    const r = await firstValueFrom(this.http.post<LoginResponse>(`${this.api}/auth/login`, { email, password, portal: this.portal }, { withCredentials: true }));
    if (r.status === 'OK') await this.accept(r.accessToken, r.expiresIn, r.next);
    return r;
  }

  async verifyMfa(mfaToken: string, code?: string, recoveryCode?: string): Promise<void> {
    const r = await firstValueFrom(
      this.http.post<Extract<LoginResponse, { status: 'OK' }>>(`${this.api}/auth/mfa/verify`, { mfaToken, code, recoveryCode }, { withCredentials: true }),
    );
    await this.accept(r.accessToken, r.expiresIn, r.next);
  }

  /** Called after password change / MFA enrolment, which return a fresh access token. */
  async accept(accessToken: string, expiresIn: number, next: NextStep = 'NONE'): Promise<void> {
    this.accessToken = accessToken;
    this.expiresAt = Date.now() + expiresIn * 1000;
    this.next.set(next);
    await this.loadMe();
  }

  async loadMe(): Promise<Me> {
    const me = await firstValueFrom(this.http.get<Me>(`${this.api}/auth/me`));
    this.me.set(me);
    if (me.session.mustChangePassword) this.next.set('PASSWORD_CHANGE');
    else if (this.portal === 'admin' && !me.session.mfaVerified) this.next.set('MFA_SETUP');
    else this.next.set('NONE');
    this.pickTenant(me);
    return me;
  }

  /** Restore the session once per page load (silent refresh using the httpOnly cookie). */
  restore(): Promise<boolean> {
    this.restored ??= this.refresh().then(async (ok) => {
      if (ok) {
        try {
          await this.loadMe();
        } catch {
          return false;
        }
      }
      return ok;
    });
    return this.restored;
  }

  /** Single-flight refresh. Returns false if the session has ended. */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async doRefresh(attempt = 0): Promise<boolean> {
    try {
      const r = await firstValueFrom(
        this.http.post<{ accessToken: string; expiresIn: number }>(`${this.api}/auth/refresh?portal=${this.portal}`, {}, { withCredentials: true }),
      );
      this.accessToken = r.accessToken;
      this.expiresAt = Date.now() + r.expiresIn * 1000;
      return true;
    } catch (e) {
      // 409: another tab rotated the cookie a moment ago — retry once with the new cookie.
      if ((e as { status?: number }).status === 409 && attempt === 0) {
        await new Promise((res) => setTimeout(res, 300));
        return this.doRefresh(1);
      }
      this.clear();
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${this.api}/auth/logout`, {}, { withCredentials: true }));
    } finally {
      this.clear();
      this.restored = Promise.resolve(false);
      await this.router.navigateByUrl(this.link('/login'));
    }
  }

  /** Session ended server-side (revoked, expired, password reset elsewhere). */
  async sessionEnded(): Promise<void> {
    this.clear();
    this.restored = Promise.resolve(false);
    await this.router.navigate([this.link('/login')], { queryParams: { reason: 'expired' } });
  }

  private clear() {
    this.accessToken = null;
    this.expiresAt = 0;
    this.me.set(null);
    this.next.set('NONE');
  }

  // ─── Organisation (tenant) selection for the customer portal ───

  selectTenant(tenantId: string) {
    const me = this.me();
    if (!me || !me.memberships.some((m) => m.tenant.id === tenantId)) return;
    this.tenantId.set(tenantId);
    try {
      localStorage.setItem(TENANT_KEY(this.portal, me.user.id), tenantId);
    } catch {
      /* storage unavailable: selection lasts for this page only */
    }
  }

  private pickTenant(me: Me) {
    if (this.portal !== 'customer' || me.memberships.length === 0) {
      this.tenantId.set(null);
      return;
    }
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(TENANT_KEY(this.portal, me.user.id));
    } catch {
      saved = null;
    }
    const valid = me.memberships.find((m) => m.tenant.id === saved) ?? me.memberships[0]!;
    this.tenantId.set(valid.tenant.id);
  }
}
