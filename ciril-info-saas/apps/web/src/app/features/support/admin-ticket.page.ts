import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { AdminPage } from '../admin/shared/admin-page';
import { FilePicker } from './file-picker';
import { type Attachment, AdminSupportApi, type AdminTicketDetail, CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL, STAFF_STATUS_LABEL, STATUSES, type TicketPriority, type TicketStatus, saveBlob } from './support.models';
import { TicketThread } from './ticket-thread';

@Component({
  selector: 'ci-admin-ticket',
  imports: [ReactiveFormsModule, RouterLink, FilePicker, Icon, PageHead, TicketThread],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .layout { display: grid; gap: var(--space-6); grid-template-columns: 1fr; }
    @media (min-width: 1024px) { .layout { grid-template-columns: 2fr 1fr; align-items: start; } }
    form { display: grid; gap: var(--space-3); }
    .side { border: 1px solid var(--color-border-subtle); display: grid; gap: var(--space-3); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-4); margin: 0; font-size: 14px; }
    dt { color: var(--color-text-secondary); }
    dd { margin: 0; overflow-wrap: anywhere; }
    .row { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center; }
  `,
  template: `
    <ci-page-head [title]="t()?.subject ?? 'Ticket'" [crumb]="t()?.ref ?? 'Ticket'">
      <a class="cf-btn cf-btn-secondary" [routerLink]="auth.link('/support')">Inbox</a>
    </ci-page-head>
    @if (toast(); as m) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ m }}</span></div> }
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    @if (t(); as tk) {
      <div class="layout">
        <div style="display:grid;gap:var(--space-5)">
          <ci-ticket-thread [messages]="tk.messages" (download)="save(tk.id, $event)" />
          @if (canWrite()) {
            @if (tk.status === 'CLOSED') {
              <div class="cf-alert cf-alert-info"><ci-icon name="info" /><span>This ticket is closed. Reopen it to reply.</span></div>
            } @else {
              <form [formGroup]="form" (ngSubmit)="send()" novalidate>
                <label for="reply" class="ts-heading-6">Reply</label>
                <textarea id="reply" class="cf-input" rows="5" formControlName="body" maxlength="10000"></textarea>
                <ci-file-picker inputId="reply-files" [(files)]="files" [disabled]="busy()" />
                <label class="cf-check"><input type="checkbox" formControlName="internal" /><span>Internal note (the customer cannot see it)</span></label>
                <div class="row"><button type="submit" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ form.controls.internal.value ? 'Add note' : 'Send reply' }}</button></div>
              </form>
            }
          }
        </div>

        <aside class="cf-card side" aria-label="Ticket details">
          <dl>
            <dt>Customer</dt><dd>{{ tk.tenant.name }}</dd>
            <dt>Opened by</dt><dd>{{ tk.openedBy.firstName }} {{ tk.openedBy.lastName }} · {{ tk.openedBy.email }}</dd>
            <dt>Topic</dt><dd>{{ cat[tk.category] }}</dd>
            <dt>Assignee</dt><dd>{{ tk.assignee ? tk.assignee.firstName + ' ' + tk.assignee.lastName : 'Unassigned' }}</dd>
          </dl>
          @if (canWrite()) {
            <label for="st" class="ts-heading-6">Status</label>
            <select id="st" class="cf-input" [value]="tk.status" [disabled]="busy()" (change)="patch({ status: $any($event.target).value })">
              @for (s of statuses; track s) { <option [value]="s" [selected]="s === tk.status">{{ staffStatus[s] }}</option> }
            </select>
            <label for="pr" class="ts-heading-6">Priority</label>
            <select id="pr" class="cf-input" [value]="tk.priority" [disabled]="busy()" (change)="patch({ priority: $any($event.target).value })">
              @for (p of priorities; track p) { <option [value]="p" [selected]="p === tk.priority">{{ pri[p] }}</option> }
            </select>
            <div class="row">
              @if (tk.assignee?.id !== me()) { <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="busy()" (click)="patch({ assigneeId: me() })">Assign to me</button> }
              @if (tk.assignee) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="patch({ assigneeId: null })">Unassign</button> }
            </div>
          }
        </aside>
      </div>
    } @else if (!error()) {
      <span class="ci-skeleton" style="height:240px"></span>
    }
  `,
})
export class AdminTicketPage extends AdminPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(AdminSupportApi);
  private readonly route = inject(ActivatedRoute);
  protected readonly statuses = STATUSES;
  protected readonly priorities = PRIORITIES;
  protected readonly staffStatus = STAFF_STATUS_LABEL;
  protected readonly pri = PRIORITY_LABEL;
  protected readonly cat = CATEGORY_LABEL;
  protected readonly t = signal<AdminTicketDetail | null>(null);
  protected readonly files = signal<File[]>([]);
  protected readonly canWrite = computed(() => this.auth.can('support:write'));
  protected readonly me = computed(() => this.auth.me()?.user?.id ?? null);
  protected readonly form = inject(NonNullableFormBuilder).group({ body: ['', [Validators.required, Validators.maxLength(10_000)]], internal: [false] });
  private id = '';

  async ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('id')!;
    await this.run(async () => this.t.set(await this.api.get(this.id)));
  }

  protected async send() {
    const body = this.form.controls.body.value.trim();
    if (!body) return;
    const internal = this.form.controls.internal.value;
    const ok = await this.run(async () => this.t.set(await this.api.reply(this.id, body, internal, this.files())));
    if (ok) {
      this.form.reset({ body: '', internal: false });
      this.files.set([]);
      this.toast.set(internal ? 'Note added.' : 'Reply sent. The customer has been notified.');
    }
  }

  protected async save(ticketId: string, a: Attachment) {
    await this.run(async () => saveBlob(await this.api.download(ticketId, a.id), a.fileName));
  }

  protected async patch(p: { status?: TicketStatus; priority?: TicketPriority; assigneeId?: string | null }) {
    const ok = await this.run(async () => this.t.set(await this.api.update(this.id, p)));
    if (ok) this.toast.set('Ticket updated.');
    else this.t.set(await this.api.get(this.id).catch(() => this.t()));
  }
}
