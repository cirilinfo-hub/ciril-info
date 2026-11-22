import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { money } from '../../customer/billing.api';
import { AdminBillingApi, type TdsRow } from '../admin-billing.api';
import { AdminPage } from '../shared/admin-page';

/** TDS customers deducted from their payments, and the certificates (Form 16A) still to chase. */
@Component({
  selector: 'ci-admin-tds',
  imports: [DatePipe, ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
    .bar .search { flex: 1 1 240px; max-width: 360px; }
    .row-actions { text-align: right; white-space: nowrap; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    td small { display: block; color: var(--color-text-secondary); }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
  `,
  template: `
    <ci-page-head title="TDS certificates" sub="TDS that business customers deducted from what they paid you. Each one needs its certificate (Form 16A) before you can claim the credit." />
    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !certFor(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <div class="bar">
      <div class="search">
        <label for="tds-search" class="cx-sr">Search TDS</label>
        <input id="tds-search" class="cf-input" type="search" placeholder="Customer or invoice number" [value]="search()" (input)="onSearch($any($event.target).value)" />
      </div>
      <button type="button" class="cf-btn cf-btn-sm" [class.cf-btn-primary]="pending()" [class.cf-btn-secondary]="!pending()" [attr.aria-pressed]="pending()" (click)="togglePending()">Certificate missing</button>
    </div>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Customer</th><th scope="col">Invoice</th><th scope="col" class="num">TDS</th><th scope="col">Certificate</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr>
              <td>{{ t.tenant.name }}</td>
              <td>{{ t.invoice.number }}<small>Recorded {{ t.createdAt | date: 'd MMM y' }}</small></td>
              <td class="num">{{ money(t.amount) }}@if (t.section) { <small>Section {{ t.section }}</small> }</td>
              <td>
                @if (t.certificateAt) { <span class="cf-badge cf-badge-success">Received</span><small>{{ t.certificateNumber }}</small> }
                @else { <span class="cf-badge cf-badge-warning">Missing</span> }
              </td>
              <td class="row-actions">
                @if (canWrite() && !t.certificateAt) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="openCert(t)" [attr.aria-label]="'Record the certificate for ' + t.invoice.number">Record certificate</button> }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5">@if (loading()) { <span class="ci-skeleton"></span> } @else if (pending()) { No certificates are missing. } @else { No TDS has been recorded yet. }</td></tr>
          }
        </tbody>
      </table>
    </div>
    @if (pageCount() > 1) {
      <div class="pager">
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
        <span>Page {{ page() }} of {{ pageCount() }}</span>
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() >= pageCount()" (click)="go(page() + 1)">Next</button>
      </div>
    }

    @if (certFor(); as t) {
      <ci-dialog [heading]="'TDS certificate for ' + t.invoice.number" [description]="t.tenant.name + ' deducted ' + money(t.amount) + '. Record the certificate they sent.'" icon="file" size="md" [dismissable]="false" (closed)="certFor.set(null)">
        <form id="tds-cert-form" [formGroup]="form" (ngSubmit)="save(t)" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Certificate number" for="tc-no" [control]="form.controls.certificateNumber" [required]="true" errorLabel="the certificate number">
            <input id="tc-no" class="cf-input" autocomplete="off" formControlName="certificateNumber" [attr.aria-describedby]="describedBy('tc-no', form.controls.certificateNumber, true)" />
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="certFor.set(null)">Cancel</button>
          <button type="submit" form="tds-cert-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Record certificate' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class AdminTdsPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminBillingApi);
  private readonly auth = inject(AuthService);
  protected readonly describedBy = describedBy;
  protected readonly money = money;
  protected readonly canWrite = computed(() => this.auth.can('billing:write'));
  protected readonly rows = signal<TdsRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly pending = signal(true);
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly certFor = signal<TdsRow | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({ certificateNumber: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(60)]] });
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit() {
    return this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.tdsList(this.page(), this.pending(), this.search());
      this.rows.set(r.data);
      this.pageCount.set(r.meta.pageCount);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected onSearch(v: string) {
    this.search.set(v.trim());
    this.page.set(1);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(), 300);
  }
  protected togglePending() {
    this.pending.set(!this.pending());
    this.page.set(1);
    return this.load();
  }
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }

  protected openCert(t: TdsRow) {
    this.error.set(null);
    this.form.reset({ certificateNumber: '' });
    this.certFor.set(t);
  }

  protected async save(t: TdsRow) {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const ok = await this.run(async () => void (await this.api.recordTdsCertificate(t.invoice.id, this.form.controls.certificateNumber.value.trim())));
    if (ok) {
      this.certFor.set(null);
      this.toast.set(`Certificate recorded for ${t.invoice.number}.`);
      await this.load();
    }
  }
}
