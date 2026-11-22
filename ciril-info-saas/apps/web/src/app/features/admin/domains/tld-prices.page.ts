import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { money } from '../../customer/billing.api';
import { type AdminTld, AdminDomainsApi } from '../admin-domains.api';
import { AdminPage } from '../shared/admin-page';

const PRICE = [Validators.required, Validators.pattern(/^\d{1,8}(\.\d{1,2})?$/)];

/** The domain price list shown on the website's Domains page. Real prices only: nothing is filled in for you. */
@Component({
  selector: 'ci-admin-tld-prices',
  imports: [ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .three { display: grid; gap: var(--space-4); grid-template-columns: 1fr; }
    @media (min-width: 640px) { .three { grid-template-columns: repeat(3, 1fr); } }
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
    .bar .search { flex: 1 1 240px; max-width: 360px; }
    .row-actions { text-align: right; white-space: nowrap; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    td small { display: block; color: var(--color-text-secondary); }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
  `,
  template: `
    <ci-page-head title="Domain prices" sub="What the website charges to register, renew and transfer each domain ending. Visitors can only search endings that are listed here and switched on.">
      @if (canWrite()) { <button type="button" class="cf-btn cf-btn-primary" (click)="openNew()"><ci-icon name="plus" [size]="16" />Add an ending</button> }
    </ci-page-head>
    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !formOpen(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <div class="bar">
      <div class="search">
        <label for="tld-search" class="cx-sr">Search endings</label>
        <input id="tld-search" class="cf-input" type="search" placeholder="Search, e.g. com" [value]="search()" (input)="onSearch($any($event.target).value)" />
      </div>
    </div>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead>
          <tr><th scope="col">Ending</th><th scope="col" class="num">Register</th><th scope="col" class="num">Renew</th><th scope="col" class="num">Transfer</th><th scope="col">Status</th><th scope="col"><span class="cx-sr">Actions</span></th></tr>
        </thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr>
              <td>.{{ t.tld }}@if (t.isSample) { <small>Development sample</small> } @else if (t.isFeatured) { <small>Featured</small> }</td>
              <td class="num">{{ money(t.registerPrice) }}</td>
              <td class="num">{{ money(t.renewPrice) }}</td>
              <td class="num">{{ money(t.transferPrice) }}</td>
              <td><span class="cf-badge" [class]="'cf-badge ' + (t.isActive ? 'cf-badge-success' : 'cf-badge-neutral')">{{ t.isActive ? 'On sale' : 'Off' }}</span></td>
              <td class="row-actions">
                @if (canWrite()) {
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="openEdit(t)" [attr.aria-label]="'Edit .' + t.tld">Edit</button>
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="toggle(t)" [attr.aria-label]="(t.isActive ? 'Turn off .' : 'Turn on .') + t.tld">{{ t.isActive ? 'Turn off' : 'Turn on' }}</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6">@if (loading()) { <span class="ci-skeleton"></span> } @else if (search()) { No ending matches “{{ search() }}”. } @else { No endings yet. Add the endings you sell with their prices and they will appear on the website. }</td></tr>
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

    @if (formOpen()) {
      <ci-dialog [heading]="editing() ? 'Edit .' + editing()!.tld : 'Add an ending'" [description]="editing() ? 'Prices are in rupees per year.' : 'The ending cannot be changed later. You can turn it off at any time.'" icon="globe" size="md" [dismissable]="false" (closed)="formOpen.set(false)">
        <form id="tld-form" [formGroup]="form" (ngSubmit)="save()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          @if (!editing()) {
            <ci-field label="Ending" for="tld-name" [control]="form.controls.tld" [required]="true" errorLabel="an ending such as com, in or co.in" hint="Without the dot: com, in, co.in.">
              <input id="tld-name" class="cf-input" autocomplete="off" autocapitalize="off" spellcheck="false" formControlName="tld" [attr.aria-describedby]="describedBy('tld-name', form.controls.tld, true)" />
            </ci-field>
          }
          <div class="three">
            <ci-field label="Register (₹)" for="tld-reg" [control]="form.controls.registerPrice" [required]="true" errorLabel="an amount in rupees, such as 799 or 799.50">
              <input id="tld-reg" class="cf-input" inputmode="decimal" formControlName="registerPrice" [attr.aria-describedby]="describedBy('tld-reg', form.controls.registerPrice)" />
            </ci-field>
            <ci-field label="Renew (₹)" for="tld-ren" [control]="form.controls.renewPrice" [required]="true" errorLabel="an amount in rupees, such as 999 or 999.50">
              <input id="tld-ren" class="cf-input" inputmode="decimal" formControlName="renewPrice" [attr.aria-describedby]="describedBy('tld-ren', form.controls.renewPrice)" />
            </ci-field>
            <ci-field label="Transfer (₹)" for="tld-tra" [control]="form.controls.transferPrice" [required]="true" errorLabel="an amount in rupees, such as 699 or 699.50">
              <input id="tld-tra" class="cf-input" inputmode="decimal" formControlName="transferPrice" [attr.aria-describedby]="describedBy('tld-tra', form.controls.transferPrice)" />
            </ci-field>
          </div>
          <label class="cf-check"><input type="checkbox" formControlName="isFeatured" /><span>Show near the top of the list</span></label>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="formOpen.set(false)">Cancel</button>
          <button type="submit" form="tld-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : editing() ? 'Save changes' : 'Add ending' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class AdminTldPricesPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminDomainsApi);
  private readonly auth = inject(AuthService);
  protected readonly describedBy = describedBy;
  protected readonly money = money;
  protected readonly canWrite = computed(() => this.auth.can('domains:write'));
  protected readonly rows = signal<AdminTld[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<AdminTld | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    tld: ['', [Validators.required, Validators.pattern(/^\.?[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)?$/)]],
    registerPrice: ['', PRICE],
    renewPrice: ['', PRICE],
    transferPrice: ['', PRICE],
    isFeatured: [false],
  });
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit() {
    return this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.list(this.page(), this.search());
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
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }

  protected openNew() {
    this.error.set(null);
    this.editing.set(null);
    this.form.reset({ tld: '', registerPrice: '', renewPrice: '', transferPrice: '', isFeatured: false });
    this.form.controls.tld.enable();
    this.formOpen.set(true);
  }

  protected openEdit(t: AdminTld) {
    this.error.set(null);
    this.editing.set(t);
    this.form.reset({ tld: t.tld, registerPrice: t.registerPrice, renewPrice: t.renewPrice, transferPrice: t.transferPrice, isFeatured: t.isFeatured });
    this.form.controls.tld.disable();
    this.formOpen.set(true);
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const prices = { registerPrice: Number(v.registerPrice), renewPrice: Number(v.renewPrice), transferPrice: Number(v.transferPrice), isFeatured: v.isFeatured };
    const current = this.editing();
    const ok = await this.run(async () => {
      if (current) await this.api.update(current.id, prices);
      else await this.api.create({ tld: v.tld.trim().replace(/^\./, '').toLowerCase(), ...prices });
    });
    if (ok) {
      this.formOpen.set(false);
      this.toast.set(current ? `.${current.tld} was updated.` : 'Ending added. It now shows on the website.');
      if (!current) this.page.set(1);
      await this.load();
    }
  }

  protected async toggle(t: AdminTld) {
    const ok = await this.run(async () => void (await this.api.update(t.id, { isActive: !t.isActive })));
    if (ok) {
      this.toast.set(`.${t.tld} was turned ${t.isActive ? 'off' : 'on'}.`);
      await this.load();
    }
  }
}
