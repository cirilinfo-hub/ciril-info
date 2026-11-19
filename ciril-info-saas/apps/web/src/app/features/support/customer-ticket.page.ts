import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { CATEGORY_LABEL, STATUS_LABEL, SupportApi, type TicketDetail } from './support.models';
import { TicketThread } from './ticket-thread';

@Component({
  selector: 'ci-customer-ticket',
  imports: [ReactiveFormsModule, RouterLink, Icon, PageHead, TicketThread],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .wrap { display: grid; gap: var(--space-5); max-width: 760px; }
    form { display: grid; gap: var(--space-3); }
    .meta { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; font-size: 14px; color: var(--color-text-secondary); }
    .row { display: flex; gap: var(--space-3); flex-wrap: wrap; }
  `,
  template: `
    <ci-page-head [title]="t()?.subject ?? 'Ticket'" [crumb]="t()?.ref ?? 'Ticket'">
      <a class="cf-btn cf-btn-secondary" [routerLink]="auth.link('/support')">All tickets</a>
    </ci-page-head>
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    @if (t(); as tk) {
      <div class="wrap">
        <div class="meta">
          <span>{{ tk.ref }}</span>
          <span class="cf-badge" [class]="'cf-badge ' + labels[tk.status].cls">{{ labels[tk.status].label }}</span>
          <span>{{ cat[tk.category] }}</span>
        </div>
        <ci-ticket-thread [messages]="tk.messages" />

        @if (tk.status === 'CLOSED') {
          <div class="cf-alert cf-alert-info"><ci-icon name="info" /><span>This ticket is closed. <a [routerLink]="auth.link('/support')">Open a new ticket</a> if you still need help.</span></div>
        } @else if (auth.can('support:write')) {
          <form [formGroup]="form" (ngSubmit)="send()" novalidate>
            <label for="reply" class="ts-heading-6">{{ tk.status === 'AWAITING_CUSTOMER' ? 'Reply to our team' : 'Add a message' }}</label>
            <textarea id="reply" class="cf-input" rows="5" formControlName="body" maxlength="10000"></textarea>
            <div class="row">
              <button type="submit" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send reply' }}</button>
              <button type="button" class="cf-btn cf-btn-secondary" [disabled]="busy()" (click)="close()">Close ticket</button>
            </div>
          </form>
        }
      </div>
    } @else if (!error()) {
      <span class="ci-skeleton" style="height:200px;max-width:760px"></span>
    }
  `,
})
export class CustomerTicketPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(SupportApi);
  private readonly route = inject(ActivatedRoute);
  protected readonly labels = STATUS_LABEL;
  protected readonly cat = CATEGORY_LABEL;
  protected readonly t = signal<TicketDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly form = inject(NonNullableFormBuilder).group({ body: ['', [Validators.required, Validators.maxLength(10_000)]] });
  private id = '';

  async ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('id')!;
    try {
      this.t.set(await this.api.get(this.id));
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  protected async send() {
    const body = this.form.controls.body.value.trim();
    if (!body) return;
    await this.act(async () => {
      this.t.set(await this.api.reply(this.id, body));
      this.form.reset({ body: '' });
    });
  }

  protected close() {
    return this.act(async () => this.t.set(await this.api.close(this.id)));
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}
