import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../design-system/icon/icon';
import { AuthLayout } from '../../layouts/auth-layout/auth-layout';

@Component({
  selector: 'ci-verify-email-page',
  imports: [RouterLink, AuthLayout, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ci-auth-layout heading="Verify Your Email">
      @switch (state()) {
        @case ('working') { <p role="status">Verifying your email address…</p> }
        @case ('ok') {
          <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>Your email is verified. You can sign in now.</span></div>
          <a class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block" [routerLink]="auth.link('/login')">Sign In</a>
        }
        @case ('error') {
          <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ message() }}</span></div>
          <a class="cf-btn cf-btn-secondary cf-btn-block" [routerLink]="auth.link('/login')">Go to Sign In to request a new link</a>
        }
      }
    </ci-auth-layout>
  `,
})
export class VerifyEmailPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  protected readonly state = signal<'working' | 'ok' | 'error'>('working');
  protected readonly message = signal('');

  async ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.state.set('error');
      this.message.set('This link is incomplete. Open the link from your email again.');
      return;
    }
    try {
      await firstValueFrom(this.http.post(`${this.auth.api}/auth/verify-email`, { token }));
      this.state.set('ok');
    } catch (e) {
      this.state.set('error');
      this.message.set(toApiError(e).message);
    }
  }
}
