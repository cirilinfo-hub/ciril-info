import { ChangeDetectionStrategy, Component, type OnInit, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { money } from '../../customer/billing.api';
import { type AdminTld, AdminDomainsApi, type MarkupType, type Rounding, type TldInput, type TldSkipped } from '../admin-domains.api';
import { AdminPage } from '../shared/admin-page';
import { applyMarkup, markupLabel, parseImport } from './tld-pricing';

const PRICE = [Validators.required, Validators.pattern(/^\d{1,8}(\.\d{1,2})?$/)];
const AMOUNT = Validators.pattern(/^\d{1,8}(\.\d{1,2})?$/);
const KINDS = ['Register', 'Renew', 'Transfer'] as const;
const COST_KEYS = ['costRegister', 'costRenew', 'costTransfer'] as const;
const PRICE_KEYS = ['registerPrice', 'renewPrice', 'transferPrice'] as const;

/**
 * The domain price list shown on the website's Domains page. Each ending has what the registrar charges us (purchase
 * price) and what the website charges; the selling price is either typed in, or worked out from the purchase price
 * with a markup (percent or rupees). Real prices only: nothing is filled in for you.
 */
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
    .bar .spacer { flex: 1; }
    .row-actions { text-align: right; white-space: nowrap; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    td small { display: block; color: var(--color-text-secondary); }
    td.pick, th.pick { width: 2.5rem; }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
    .group-label { font-weight: 600; margin: 0; }
    .hint { color: var(--color-text-secondary); margin: 0; font-size: var(--text-sm, 0.875rem); }
    .preview { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); padding: var(--space-3); border-radius: var(--radius-md, 8px); background: var(--color-surface-subtle, rgba(0,0,0,.03)); }
    .preview span { display: block; color: var(--color-text-secondary); font-size: var(--text-sm, 0.875rem); }
    .preview strong { font-variant-numeric: tabular-nums; }
    .modes { display: flex; flex-wrap: wrap; gap: var(--space-4); }
    ul.skipped { margin: var(--space-2) 0 0; padding-left: 1.25rem; max-height: 10rem; overflow: auto; }
    textarea.sheet { font-family: var(--font-mono, ui-monospace, monospace); min-height: 10rem; }
  `,
  template: `
    <ci-page-head title="Domain prices" sub="What we pay the registrar for each domain ending, and what the website charges. Visitors can only search endings that are listed here and switched on. Purchase prices are never shown on the website.">
      @if (canWrite()) {
        <button type="button" class="cf-btn cf-btn-secondary" (click)="openImport()"><ci-icon name="upload" [size]="16" />Import purchase prices</button>
        <button type="button" class="cf-btn cf-btn-primary" (click)="openNew()"><ci-icon name="plus" [size]="16" />Add an ending</button>
      }
    </ci-page-head>
    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (skipped().length) {
      <div class="cf-alert cf-alert-warning" role="status"><ci-icon name="warning" />
        <span>{{ skipped().length }} {{ skipped().length === 1 ? 'ending was' : 'endings were' }} left unchanged:
          <ul class="skipped">@for (s of skipped(); track s.tld) { <li>.{{ s.tld }}: {{ s.reason }}</li> }</ul>
        </span>
      </div>
    }
    @if (error() && !anyDialog(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <div class="bar">
      <div class="search">
        <label for="tld-search" class="cx-sr">Search endings</label>
        <input id="tld-search" class="cf-input" type="search" placeholder="Search, e.g. com" [value]="search()" (input)="onSearch($any($event.target).value)" />
      </div>
      <span class="spacer"></span>
      @if (canWrite() && rows().length) {
        @if (selected().size) { <span>{{ selected().size }} selected</span> <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="clearSelection()">Clear</button> }
        <button type="button" class="cf-btn cf-btn-secondary" (click)="openBulk()"><ci-icon name="percent" [size]="16" />{{ selected().size ? 'Change prices of selected' : 'Change prices in bulk' }}</button>
      }
    </div>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead>
          <tr>
            @if (canWrite()) { <th scope="col" class="pick"><input type="checkbox" aria-label="Select every ending on this page" [checked]="allOnPage()" [disabled]="!rows().length" (change)="selectPage($any($event.target).checked)" /></th> }
            <th scope="col">Ending</th><th scope="col" class="num">Register</th><th scope="col" class="num">Renew</th><th scope="col" class="num">Transfer</th><th scope="col">Pricing</th><th scope="col">Status</th><th scope="col"><span class="cx-sr">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr>
              @if (canWrite()) { <td class="pick"><input type="checkbox" [attr.aria-label]="'Select .' + t.tld" [checked]="selected().has(t.id)" (change)="pick(t.id, $any($event.target).checked)" /></td> }
              <td>.{{ t.tld }}@if (t.isSample) { <small>Development sample</small> } @else if (t.isFeatured) { <small>Featured</small> }</td>
              <td class="num">{{ money(t.registerPrice) }}@if (t.costRegister !== null) { <small>cost {{ money(t.costRegister) }}</small> }</td>
              <td class="num">{{ money(t.renewPrice) }}@if (t.costRenew !== null) { <small>cost {{ money(t.costRenew) }}</small> }</td>
              <td class="num">{{ money(t.transferPrice) }}@if (t.costTransfer !== null) { <small>cost {{ money(t.costTransfer) }}</small> }</td>
              <td>{{ markupLabel(t.markupType, t.markupValue) }}@if (margin(t); as m) { <small>{{ m }}</small> }</td>
              <td><span [class]="'cf-badge ' + (t.isActive ? 'cf-badge-success' : 'cf-badge-neutral')">{{ t.isActive ? 'On sale' : 'Off' }}</span></td>
              <td class="row-actions">
                @if (canWrite()) {
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="openEdit(t)" [attr.aria-label]="'Edit .' + t.tld">Edit</button>
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="toggle(t)" [attr.aria-label]="(t.isActive ? 'Turn off .' : 'Turn on .') + t.tld">{{ t.isActive ? 'Turn off' : 'Turn on' }}</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td [attr.colspan]="canWrite() ? 8 : 7">@if (loading()) { <span class="ci-skeleton"></span> } @else if (search()) { No ending matches “{{ search() }}”. } @else { No endings yet. Import the purchase prices from your registrar's price sheet, or add endings one by one. }</td></tr>
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

    <!-- Add / edit one ending -->
    @if (formOpen()) {
      <ci-dialog [heading]="editing() ? 'Edit .' + editing()!.tld : 'Add an ending'" [description]="editing() ? 'Prices are in rupees per year, before GST.' : 'The ending cannot be changed later. You can turn it off at any time. Prices are in rupees per year, before GST.'" icon="globe" size="lg" [dismissable]="false" (closed)="formOpen.set(false)">
        <form id="tld-form" [formGroup]="form" (ngSubmit)="save()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          @if (!editing()) {
            <ci-field label="Ending" for="tld-name" [control]="form.controls.tld" [required]="true" errorLabel="an ending such as com, in or co.in" hint="Without the dot: com, in, co.in.">
              <input id="tld-name" class="cf-input" autocomplete="off" autocapitalize="off" spellcheck="false" formControlName="tld" [attr.aria-describedby]="describedBy('tld-name', form.controls.tld, true)" />
            </ci-field>
          }

          <p class="group-label">Purchase price (what the registrar charges us)</p>
          <div class="three">
            @for (k of costKeys; track k; let i = $index) {
              <ci-field [label]="kinds[i] + ' cost (₹)'" [for]="'tld-' + k" [control]="form.controls[k]" [required]="mode() === 'MARKUP'" errorLabel="an amount in rupees, such as 750 or 750.50">
                <input [id]="'tld-' + k" class="cf-input" inputmode="decimal" [formControlName]="k" [attr.aria-describedby]="describedBy('tld-' + k, form.controls[k])" />
              </ci-field>
            }
          </div>

          <fieldset class="cf-fieldset" style="border:0;padding:0;margin:0">
            <legend class="group-label">Selling price</legend>
            <div class="modes">
              <label class="cf-radio"><input type="radio" formControlName="mode" value="MARKUP" /><span>Purchase price plus a markup</span></label>
              <label class="cf-radio"><input type="radio" formControlName="mode" value="HAND" /><span>Type the prices in</span></label>
            </div>
          </fieldset>

          @if (mode() === 'MARKUP') {
            <div class="three">
              <ci-field label="Markup" for="tld-mtype" [control]="form.controls.markupType">
                <select id="tld-mtype" class="cf-input" formControlName="markupType"><option value="PERCENT">Percent (%)</option><option value="AMOUNT">Amount (₹)</option></select>
              </ci-field>
              <ci-field [label]="form.controls.markupType.value === 'PERCENT' ? 'Markup (%)' : 'Markup (₹)'" for="tld-mval" [control]="form.controls.markupValue" [required]="true" errorLabel="a number such as 20 or 150">
                <input id="tld-mval" class="cf-input" inputmode="decimal" formControlName="markupValue" [attr.aria-describedby]="describedBy('tld-mval', form.controls.markupValue)" />
              </ci-field>
              <ci-field label="Round up" for="tld-mround" [control]="form.controls.markupRound">
                <select id="tld-mround" class="cf-input" formControlName="markupRound"><option value="NONE">No rounding</option><option value="RUPEE">To whole rupees</option><option value="NINE">To end in 9 (e.g. ₹799)</option></select>
              </ci-field>
            </div>
            <div class="preview" aria-live="polite">
              @for (p of preview(); track p.label) { <div><span>{{ p.label }}</span><strong>{{ p.value === null ? '—' : money(p.value) }}</strong></div> }
            </div>
            <p class="hint">When the purchase price changes (here or by import), the selling price follows it.</p>
          } @else {
            <div class="three">
              @for (k of priceKeys; track k; let i = $index) {
                <ci-field [label]="kinds[i] + ' (₹)'" [for]="'tld-' + k" [control]="form.controls[k]" [required]="true" errorLabel="an amount in rupees, such as 799 or 799.50">
                  <input [id]="'tld-' + k" class="cf-input" inputmode="decimal" [formControlName]="k" [attr.aria-describedby]="describedBy('tld-' + k, form.controls[k])" />
                </ci-field>
              }
            </div>
          }
          <label class="cf-check"><input type="checkbox" formControlName="isFeatured" /><span>Show near the top of the list</span></label>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="formOpen.set(false)">Cancel</button>
          <button type="submit" form="tld-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : editing() ? 'Save changes' : 'Add ending' }}</button>
        </ng-container>
      </ci-dialog>
    }

    <!-- One markup over many endings -->
    @if (bulkOpen()) {
      <ci-dialog heading="Change prices in bulk" description="Add a percentage or a fixed amount to many endings at once." icon="percent" size="md" [dismissable]="false" (closed)="bulkOpen.set(false)">
        <form id="bulk-form" [formGroup]="bulkForm" (ngSubmit)="saveBulk()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <fieldset style="border:0;padding:0;margin:0">
            <legend class="group-label">Which endings</legend>
            <div class="modes">
              <label class="cf-radio"><input type="radio" formControlName="scope" value="SELECTED" [attr.disabled]="selected().size ? null : true" /><span>The {{ selected().size }} selected</span></label>
              <label class="cf-radio"><input type="radio" formControlName="scope" value="ALL" /><span>{{ search() ? 'Every ending matching “' + search() + '”' : 'Every ending' }}</span></label>
            </div>
          </fieldset>
          <fieldset style="border:0;padding:0;margin:0">
            <legend class="group-label">Add the markup to</legend>
            <label class="cf-radio"><input type="radio" formControlName="basis" value="COST" /><span>The purchase price, and keep it (prices follow future purchase-price changes; endings without purchase prices are skipped)</span></label>
            <label class="cf-radio"><input type="radio" formControlName="basis" value="CURRENT" /><span>Today's selling price, once (the endings are then priced by hand)</span></label>
          </fieldset>
          <div class="three">
            <ci-field label="Markup" for="bk-type" [control]="bulkForm.controls.markupType">
              <select id="bk-type" class="cf-input" formControlName="markupType"><option value="PERCENT">Percent (%)</option><option value="AMOUNT">Amount (₹)</option></select>
            </ci-field>
            <ci-field [label]="bulkForm.controls.markupType.value === 'PERCENT' ? 'Markup (%)' : 'Markup (₹)'" for="bk-val" [control]="bulkForm.controls.markupValue" [required]="true" errorLabel="a number such as 20 or 150">
              <input id="bk-val" class="cf-input" inputmode="decimal" formControlName="markupValue" [attr.aria-describedby]="describedBy('bk-val', bulkForm.controls.markupValue)" />
            </ci-field>
            <ci-field label="Round up" for="bk-round" [control]="bulkForm.controls.markupRound">
              <select id="bk-round" class="cf-input" formControlName="markupRound"><option value="NONE">No rounding</option><option value="RUPEE">To whole rupees</option><option value="NINE">To end in 9</option></select>
            </ci-field>
          </div>
          <p class="hint">Example: a ₹1,000 price {{ bulkExample() }}.</p>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="bulkOpen.set(false)">Cancel</button>
          <button type="submit" form="bulk-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Applying…' : 'Apply' }}</button>
        </ng-container>
      </ci-dialog>
    }

    <!-- Purchase prices from the registrar's price sheet -->
    @if (importOpen()) {
      <ci-dialog heading="Import purchase prices" description="Paste the endings and what the registrar charges, from its price sheet or a spreadsheet." icon="upload" size="lg" [dismissable]="false" (closed)="importOpen.set(false)">
        <form id="import-form" [formGroup]="importForm" (ngSubmit)="saveImport()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Price sheet" for="im-text" [control]="importForm.controls.text" [required]="true" hint="One ending per line: ending, register, renew, transfer (rupees per year). Copy four columns from a spreadsheet, or type: com, 850, 1050, 850">
            <textarea id="im-text" class="cf-input sheet" rows="8" spellcheck="false" formControlName="text" placeholder="com, 850, 1050, 850&#10;in, 550, 650, 550&#10;co.in, 450, 500, 450" [attr.aria-describedby]="describedBy('im-text', importForm.controls.text, true)"></textarea>
          </ci-field>
          @if (parsed(); as p) {
            @if (p.rows.length || p.errors.length) {
              <p class="hint" aria-live="polite">{{ p.rows.length }} {{ p.rows.length === 1 ? 'ending' : 'endings' }} read@if (p.errors.length) {; {{ p.errors.length }} {{ p.errors.length === 1 ? 'line' : 'lines' }} cannot be read and will be ignored}.</p>
              @if (p.errors.length) { <ul class="skipped">@for (e of p.errors.slice(0, 20); track e.line) { <li>Line {{ e.line }} (“{{ e.text }}”): {{ e.reason }}</li> }</ul> }
            }
          }
          <label class="cf-check"><input type="checkbox" formControlName="useMarkup" /><span>Give new endings selling prices with a markup</span></label>
          @if (importForm.controls.useMarkup.value) {
            <div class="three">
              <ci-field label="Markup" for="im-type" [control]="importForm.controls.markupType">
                <select id="im-type" class="cf-input" formControlName="markupType"><option value="PERCENT">Percent (%)</option><option value="AMOUNT">Amount (₹)</option></select>
              </ci-field>
              <ci-field [label]="importForm.controls.markupType.value === 'PERCENT' ? 'Markup (%)' : 'Markup (₹)'" for="im-val" [control]="importForm.controls.markupValue" [required]="true" errorLabel="a number such as 20 or 150">
                <input id="im-val" class="cf-input" inputmode="decimal" formControlName="markupValue" [attr.aria-describedby]="describedBy('im-val', importForm.controls.markupValue)" />
              </ci-field>
              <ci-field label="Round up" for="im-round" [control]="importForm.controls.markupRound">
                <select id="im-round" class="cf-input" formControlName="markupRound"><option value="NONE">No rounding</option><option value="RUPEE">To whole rupees</option><option value="NINE">To end in 9</option></select>
              </ci-field>
            </div>
            <label class="cf-check"><input type="checkbox" formControlName="repriceManual" /><span>Also put endings I priced by hand on this markup</span></label>
          } @else {
            <p class="hint">Without a markup, only endings already in the list are updated; new ones are skipped.</p>
          }
          <label class="cf-check"><input type="checkbox" formControlName="activate" /><span>Put new endings on sale straight away (otherwise they are added switched off, to check first)</span></label>
          <p class="hint">Endings already in the list get the new purchase prices; those on a markup get new selling prices too.</p>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="importOpen.set(false)">Cancel</button>
          <button type="submit" form="import-form" class="cf-btn cf-btn-primary" [disabled]="busy() || !parsed().rows.length">{{ busy() ? 'Importing…' : 'Import ' + parsed().rows.length + (parsed().rows.length === 1 ? ' ending' : ' endings') }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class AdminTldPricesPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminDomainsApi);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly describedBy = describedBy;
  protected readonly money = money;
  protected readonly markupLabel = markupLabel;
  protected readonly kinds = KINDS;
  protected readonly costKeys = COST_KEYS;
  protected readonly priceKeys = PRICE_KEYS;
  protected readonly canWrite = computed(() => this.auth.can('domains:write'));
  protected readonly rows = signal<AdminTld[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly formOpen = signal(false);
  protected readonly bulkOpen = signal(false);
  protected readonly importOpen = signal(false);
  protected readonly anyDialog = computed(() => this.formOpen() || this.bulkOpen() || this.importOpen());
  protected readonly editing = signal<AdminTld | null>(null);
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly skipped = signal<TldSkipped[]>([]);
  protected readonly allOnPage = computed(() => this.rows().length > 0 && this.rows().every((r) => this.selected().has(r.id)));

  protected readonly form = this.fb.group({
    tld: ['', [Validators.required, Validators.pattern(/^\.?[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)?$/)]],
    costRegister: ['', AMOUNT],
    costRenew: ['', AMOUNT],
    costTransfer: ['', AMOUNT],
    mode: ['MARKUP' as 'MARKUP' | 'HAND'],
    markupType: ['PERCENT' as MarkupType],
    markupValue: ['', AMOUNT],
    markupRound: ['NINE' as Rounding],
    registerPrice: ['', AMOUNT],
    renewPrice: ['', AMOUNT],
    transferPrice: ['', AMOUNT],
    isFeatured: [false],
  });
  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly mode = computed(() => this.formValue().mode ?? 'MARKUP');
  /** The selling prices the markup gives, before saving. */
  protected readonly preview = computed(() => {
    const v = this.formValue();
    const ok = (s?: string) => !!s && /^\d{1,8}(\.\d{1,2})?$/.test(s);
    return COST_KEYS.map((k, i) => ({
      label: KINDS[i],
      value: ok(v[k]) && ok(v.markupValue) ? applyMarkup(Number(v[k]), v.markupType ?? 'PERCENT', Number(v.markupValue), v.markupRound ?? 'NONE') : null,
    }));
  });

  protected readonly bulkForm = this.fb.group({
    scope: ['ALL' as 'SELECTED' | 'ALL'],
    basis: ['COST' as 'COST' | 'CURRENT'],
    markupType: ['PERCENT' as MarkupType],
    markupValue: ['', PRICE],
    markupRound: ['NINE' as Rounding],
  });
  private readonly bulkValue = toSignal(this.bulkForm.valueChanges, { initialValue: this.bulkForm.getRawValue() });
  protected readonly bulkExample = computed(() => {
    const v = this.bulkValue();
    if (!v.markupValue || !/^\d{1,8}(\.\d{1,2})?$/.test(v.markupValue)) return 'changes by the markup you enter';
    return `becomes ${money(applyMarkup(1000, v.markupType ?? 'PERCENT', Number(v.markupValue), v.markupRound ?? 'NONE'))}`;
  });

  protected readonly importForm = this.fb.group({
    text: ['', Validators.required],
    useMarkup: [true],
    markupType: ['PERCENT' as MarkupType],
    markupValue: ['', AMOUNT],
    markupRound: ['NINE' as Rounding],
    repriceManual: [false],
    activate: [false],
  });
  private readonly importText = toSignal(this.importForm.controls.text.valueChanges, { initialValue: '' });
  protected readonly parsed = computed(() => parseImport(this.importText()));

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    // What is required follows the chosen mode at once, so errors from the other mode do not linger.
    effect(() => this.requireFor(this.mode()));
  }

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

  protected pick(id: string, on: boolean) {
    const s = new Set(this.selected());
    if (on) s.add(id);
    else s.delete(id);
    this.selected.set(s);
  }
  protected clearSelection() {
    this.selected.set(new Set());
  }
  protected selectPage(on: boolean) {
    const s = new Set(this.selected());
    for (const r of this.rows()) {
      if (on) s.add(r.id);
      else s.delete(r.id);
    }
    this.selected.set(s);
  }

  /** "Margin ₹149 (21%)" on the register price, when the purchase price is known. */
  protected margin(t: AdminTld): string | null {
    if (t.costRegister === null) return null;
    const cost = Number(t.costRegister);
    const diff = Number(t.registerPrice) - cost;
    return `Margin ${money(diff)}${cost > 0 ? ` (${Math.round((diff / cost) * 100)}%)` : ''}`;
  }

  private clearNotices() {
    this.error.set(null);
    this.skipped.set([]);
  }

  protected openNew() {
    this.clearNotices();
    this.editing.set(null);
    this.form.reset({ tld: '', costRegister: '', costRenew: '', costTransfer: '', mode: 'MARKUP', markupType: 'PERCENT', markupValue: '', markupRound: 'NINE', registerPrice: '', renewPrice: '', transferPrice: '', isFeatured: false });
    this.form.controls.tld.enable();
    this.formOpen.set(true);
  }

  protected openEdit(t: AdminTld) {
    this.clearNotices();
    this.editing.set(t);
    const s = (v: string | null) => (v === null ? '' : String(Number(v)));
    this.form.reset({
      tld: t.tld, costRegister: s(t.costRegister), costRenew: s(t.costRenew), costTransfer: s(t.costTransfer),
      mode: t.markupType ? 'MARKUP' : 'HAND', markupType: t.markupType ?? 'PERCENT', markupValue: s(t.markupValue), markupRound: t.markupType ? t.markupRound : 'NINE',
      registerPrice: s(t.registerPrice), renewPrice: s(t.renewPrice), transferPrice: s(t.transferPrice), isFeatured: t.isFeatured,
    });
    this.form.controls.tld.disable();
    this.formOpen.set(true);
  }

  /** Purchase prices are required only with a markup; selling prices only when typed in. */
  private requireFor(mode: 'MARKUP' | 'HAND') {
    const c = this.form.controls;
    for (const k of COST_KEYS) c[k].setValidators(mode === 'MARKUP' ? PRICE : AMOUNT);
    c.markupValue.setValidators(mode === 'MARKUP' ? PRICE : AMOUNT);
    for (const k of PRICE_KEYS) c[k].setValidators(mode === 'HAND' ? PRICE : AMOUNT);
    for (const k of [...COST_KEYS, ...PRICE_KEYS, 'markupValue'] as const) c[k].updateValueAndValidity();
  }

  protected async save() {
    const v = this.form.getRawValue();
    this.requireFor(v.mode);
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const cost = (s: string) => (s === '' ? null : Number(s));
    const costs = { costRegister: cost(v.costRegister), costRenew: cost(v.costRenew), costTransfer: cost(v.costTransfer) };
    const body: Omit<TldInput, 'tld'> =
      v.mode === 'MARKUP'
        ? { ...costs, markupType: v.markupType, markupValue: Number(v.markupValue), markupRound: v.markupRound, isFeatured: v.isFeatured }
        : { ...costs, markupType: null, registerPrice: Number(v.registerPrice), renewPrice: Number(v.renewPrice), transferPrice: Number(v.transferPrice), isFeatured: v.isFeatured };
    const current = this.editing();
    const ok = await this.run(async () => {
      if (current) await this.api.update(current.id, body);
      else {
        // A new ending has nothing to clear: leave out empty costs and the "no markup" flag.
        const { markupType, ...rest } = body;
        const fresh = Object.fromEntries(Object.entries(rest).filter(([, x]) => x !== null));
        await this.api.create({ tld: v.tld.trim().replace(/^\./, '').toLowerCase(), ...fresh, ...(markupType ? { markupType } : {}) });
      }
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

  protected openBulk() {
    this.clearNotices();
    this.bulkForm.reset({ scope: this.selected().size ? 'SELECTED' : 'ALL', basis: 'COST', markupType: 'PERCENT', markupValue: '', markupRound: 'NINE' });
    this.bulkOpen.set(true);
  }

  protected async saveBulk() {
    this.bulkForm.markAllAsTouched();
    if (this.bulkForm.invalid) return;
    const v = this.bulkForm.getRawValue();
    const markup = { markupType: v.markupType, markupValue: Number(v.markupValue), markupRound: v.markupRound, basis: v.basis };
    const scope = v.scope === 'SELECTED' && this.selected().size ? { ids: [...this.selected()] } : { all: true as const, ...(this.search() ? { search: this.search() } : {}) };
    let result: { changed: number; skipped: TldSkipped[] } | undefined;
    const ok = await this.run(async () => void (result = await this.api.bulkPrice({ ...markup, ...scope })));
    if (ok && result) {
      this.bulkOpen.set(false);
      this.selected.set(new Set());
      this.toast.set(`${result.changed} ${result.changed === 1 ? 'ending was' : 'endings were'} re-priced.`);
      this.skipped.set(result.skipped);
      await this.load();
    }
  }

  protected openImport() {
    this.clearNotices();
    this.importForm.reset({ text: '', useMarkup: true, markupType: 'PERCENT', markupValue: '', markupRound: 'NINE', repriceManual: false, activate: false });
    this.importOpen.set(true);
  }

  protected async saveImport() {
    const c = this.importForm.controls;
    c.markupValue.setValidators(c.useMarkup.value ? PRICE : AMOUNT);
    c.markupValue.updateValueAndValidity({ emitEvent: false });
    this.importForm.markAllAsTouched();
    const rows = this.parsed().rows;
    if (this.importForm.invalid || !rows.length) return;
    const v = this.importForm.getRawValue();
    const markup = v.useMarkup ? { markupType: v.markupType, markupValue: Number(v.markupValue), markupRound: v.markupRound } : undefined;
    let result: { created: number; updated: number; skipped: TldSkipped[] } | undefined;
    const ok = await this.run(async () => void (result = await this.api.importCosts({ rows, ...(markup ? { markup } : {}), repriceManual: v.useMarkup && v.repriceManual, activate: v.activate })));
    if (ok && result) {
      this.importOpen.set(false);
      const added = result.created ? `${result.created} added${v.activate ? '' : ' (switched off: check them, then turn them on)'}` : '';
      const updated = result.updated ? `${result.updated} updated` : '';
      this.toast.set(`Purchase prices imported: ${[added, updated].filter(Boolean).join(', ') || 'nothing changed'}.`);
      this.skipped.set(result.skipped);
      this.page.set(1);
      await this.load();
    }
  }
}
