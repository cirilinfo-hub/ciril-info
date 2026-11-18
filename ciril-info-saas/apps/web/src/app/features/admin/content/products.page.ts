import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { CYCLE_LABEL, formatMoney } from '../../public/shared/plan-pricing';
import { type AdminPlan, type AdminProduct, AdminContentApi, type BillingCycle } from '../admin-content.api';
import { AdminPage, lines } from '../shared/admin-page';

const TYPES: Record<string, string> = {
  WEB_HOSTING: 'Web hosting', WORDPRESS_HOSTING: 'WordPress hosting', CLOUD_HOSTING: 'Cloud hosting', VPS_HOSTING: 'VPS hosting', DOMAIN: 'Domains',
  BUSINESS_EMAIL: 'Business email', WEBSITE_DESIGN: 'Website design', WEBSITE_DEVELOPMENT: 'Website development', WEBSITE_MAINTENANCE: 'Website maintenance',
  SEO: 'SEO', DIGITAL_MARKETING: 'Digital marketing',
};
const STATUS_LABEL = { DRAFT: 'Draft', PUBLISHED: 'Published', ARCHIVED: 'Archived' } as const;
const STATUS_BADGE = { DRAFT: 'cf-badge-neutral', PUBLISHED: 'cf-badge-success', ARCHIVED: 'cf-badge-warning' } as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
const num = (s: string) => (s.trim() === '' ? null : Number(s));
const MONEY = Validators.pattern(/^\s*\d{1,9}(\.\d{1,2})?\s*$/);
const OPT_MONEY = Validators.pattern(/^\s*(\d{1,9}(\.\d{1,2})?)?\s*$/);

type Dlg = null | 'product' | 'plan' | 'editPlan' | 'features' | 'price';

@Component({
  selector: 'ci-admin-products',
  imports: [ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-4); }
    .product { margin-bottom: var(--space-6); }
    .phead { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-3); }
    .phead h2 { margin: 0; }
    .phead small, .name small { display: block; color: var(--color-text-secondary); font-weight: 400; }
    .btns { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .prices { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
    .none { color: var(--color-text-secondary); }
    .row-actions { text-align: right; white-space: nowrap; }
    .hist { margin: 0; padding-left: var(--space-5); color: var(--color-text-secondary); font-size: 14px; }
    .note { margin: 0; color: var(--color-text-secondary); font-size: 14px; }
  `,
  template: `
    <ci-page-head title="Products and pricing" sub="Plans and prices shown on the Hosting and Pricing pages. A plan appears on the website only when it is published and has a current price.">
      @if (canWrite()) { <button type="button" class="cf-btn cf-btn-primary" (click)="openProduct()"><ci-icon name="plus" [size]="16" />Add Product</button> }
    </ci-page-head>

    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !dlg()) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    @for (p of products(); track p.id) {
      <section class="product" [attr.aria-labelledby]="'p-' + p.id">
        <div class="phead">
          <div>
            <h2 [id]="'p-' + p.id" class="ts-heading-5">{{ p.name }} <span class="cf-badge" [class]="'cf-badge ' + statusBadge(p.status)">{{ statusLabel(p.status) }}</span></h2>
            <small>{{ typeLabel(p.type) }} · {{ p.category.name }}</small>
          </div>
          @if (canWrite()) {
            <div class="btns">
              <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" (click)="openProduct(p)">Edit product</button>
              <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" (click)="openPlan(p)"><ci-icon name="plus" [size]="16" />Add plan</button>
            </div>
          }
        </div>
        <div class="cf-table-wrap">
          <table class="cf-table">
            <thead><tr><th scope="col">Plan</th><th scope="col">Status</th><th scope="col">Current prices</th><th scope="col">Features</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
            <tbody>
              @for (pl of p.plans; track pl.id) {
                <tr>
                  <td class="name">{{ pl.name }}@if (pl.isFeatured) { <span class="cf-badge cf-badge-brand">Featured</span> }@if (pl.isSample) { <span class="cf-badge cf-badge-warning">Sample</span> }<small>{{ pl.slug }}</small></td>
                  <td><span class="cf-badge" [class]="'cf-badge ' + statusBadge(pl.status)">{{ statusLabel(pl.status) }}</span></td>
                  <td>
                    @if (current(pl).length) {
                      <ul class="prices">
                        @for (pr of current(pl); track pr.id) { <li>{{ cycle(pr.billingCycle) }}: <strong>{{ money(pr.price) }}</strong>{{ " " }}<span class="none">(renews {{ money(pr.renewalPrice) }})</span></li> }
                      </ul>
                    } @else { <span class="none">No price yet</span> }
                  </td>
                  <td>{{ pl.features.length }}</td>
                  <td class="row-actions">
                    @if (canWrite()) {
                      <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="openEditPlan(p, pl)">Edit</button>
                      <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="openFeatures(pl)">Features</button>
                      <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="openPrice(pl)">Set price</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="5">No plans yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @empty {
      @if (loading()) { <span class="ci-skeleton"></span> } @else { <p>No products yet. Add a product, then its plans and prices.</p> }
    }

    @if (dlg() === 'product') {
      <ci-dialog [heading]="editProduct() ? 'Edit Product' : 'Add Product'" icon="layers" size="md" [dismissable]="false" (closed)="close()">
        <form id="prod-form" [formGroup]="productForm" (ngSubmit)="saveProduct()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Name" for="pr-name" [control]="productForm.controls.name" [required]="true">
            <input id="pr-name" class="cf-input" formControlName="name" (blur)="suggestSlug(productForm)" [attr.aria-describedby]="describedBy('pr-name', productForm.controls.name)" />
          </ci-field>
          @if (!editProduct()) {
            <div class="two">
              <ci-field label="Web address slug" for="pr-slug" [control]="productForm.controls.slug" [required]="true" hint="Lowercase letters, numbers and hyphens. Cannot be changed later.">
                <input id="pr-slug" class="cf-input" formControlName="slug" [attr.aria-describedby]="describedBy('pr-slug', productForm.controls.slug, true)" />
              </ci-field>
              <ci-field label="Type" for="pr-type" [required]="true">
                <select id="pr-type" class="cf-input" formControlName="type">@for (t of typeKeys; track t) { <option [value]="t">{{ typeLabel(t) }}</option> }</select>
              </ci-field>
              <ci-field label="Category" for="pr-cat" [control]="productForm.controls.categorySlug" [required]="true" errorLabel="a category">
                <select id="pr-cat" class="cf-input" formControlName="categorySlug">@for (c of categories(); track c.slug) { <option [value]="c.slug">{{ c.name }}</option> }</select>
              </ci-field>
            </div>
          }
          <ci-field label="Tagline" for="pr-tag" [optional]="true"><input id="pr-tag" class="cf-input" formControlName="tagline" maxlength="255" /></ci-field>
          <ci-field label="Description" for="pr-desc" [optional]="true"><textarea id="pr-desc" class="cf-input" rows="3" formControlName="description"></textarea></ci-field>
          <ci-field label="Status" for="pr-status" hint="Only published products appear on the website.">
            <select id="pr-status" class="cf-input" formControlName="status" aria-describedby="pr-status-hint">
              <option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option>
            </select>
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="close()">Cancel</button>
          <button type="submit" form="prod-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (dlg() === 'plan' || dlg() === 'editPlan') {
      <ci-dialog [heading]="dlg() === 'plan' ? 'Add Plan' : 'Edit Plan'" [description]="target()?.name" icon="tag" size="md" [dismissable]="false" (closed)="close()">
        <form id="plan-form" [formGroup]="planForm" (ngSubmit)="savePlan()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Plan name" for="pl-name" [control]="planForm.controls.name" [required]="true">
            <input id="pl-name" class="cf-input" formControlName="name" (blur)="suggestSlug(planForm)" [attr.aria-describedby]="describedBy('pl-name', planForm.controls.name)" />
          </ci-field>
          @if (dlg() === 'plan') {
            <ci-field label="Web address slug" for="pl-slug" [control]="planForm.controls.slug" [required]="true" hint="Lowercase letters, numbers and hyphens. Cannot be changed later.">
              <input id="pl-slug" class="cf-input" formControlName="slug" [attr.aria-describedby]="describedBy('pl-slug', planForm.controls.slug, true)" />
            </ci-field>
          }
          <ci-field label="Short description" for="pl-desc" [optional]="true"><textarea id="pl-desc" class="cf-input" rows="2" formControlName="description"></textarea></ci-field>
          <label class="cf-check"><input type="checkbox" formControlName="isFeatured" /><span>Highlight as the most popular plan</span></label>
          @if (dlg() === 'editPlan') {
            <ci-field label="Status" for="pl-status" hint="Publishing needs a current price. Only published plans appear on the website.">
              <select id="pl-status" class="cf-input" formControlName="status" aria-describedby="pl-status-hint">
                <option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option>
              </select>
            </ci-field>
          }
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="close()">Cancel</button>
          <button type="submit" form="plan-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (dlg() === 'features') {
      <ci-dialog heading="Plan features" [description]="plan()?.name" icon="check-circle" size="md" [dismissable]="false" (closed)="close()">
        <form id="feat-form" [formGroup]="featForm" (ngSubmit)="saveFeatures()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Features" for="ft-text" hint="One per line. Write amounts in the sentence (“25 GB NVMe storage”, “5 email accounts”) so the comparison table can line plans up. Start a line with * to highlight it. To set a value separately, write “label | value”.">
            <textarea id="ft-text" class="cf-input" rows="12" formControlName="text" aria-describedby="ft-text-hint"></textarea>
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="close()">Cancel</button>
          <button type="submit" form="feat-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save Features' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (dlg() === 'price') {
      <ci-dialog heading="Set price" [description]="plan()?.name" icon="tag" size="md" [dismissable]="false" (closed)="close()">
        <form id="price-form" [formGroup]="priceForm" (ngSubmit)="savePrice()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <p class="note">A new price takes effect immediately and replaces the current price for that billing period. Earlier prices are kept, so existing invoices are unchanged. Amounts are in ₹ (INR), excluding GST.</p>
          <ci-field label="Billing period" for="pc-cycle" [required]="true">
            <select id="pc-cycle" class="cf-input" formControlName="billingCycle">@for (c of cycleKeys; track c) { <option [value]="c">{{ cycle(c) }}</option> }</select>
          </ci-field>
          <div class="two">
            <ci-field label="Price for the first term (₹)" for="pc-price" [control]="priceForm.controls.price" [required]="true" errorLabel="a price">
              <input id="pc-price" class="cf-input" inputmode="decimal" formControlName="price" [attr.aria-describedby]="describedBy('pc-price', priceForm.controls.price)" />
            </ci-field>
            <ci-field label="Renewal price (₹)" for="pc-renew" [control]="priceForm.controls.renewalPrice" [required]="true" errorLabel="a renewal price">
              <input id="pc-renew" class="cf-input" inputmode="decimal" formControlName="renewalPrice" [attr.aria-describedby]="describedBy('pc-renew', priceForm.controls.renewalPrice)" />
            </ci-field>
            <ci-field label="List price (₹)" for="pc-list" [control]="priceForm.controls.listPrice" [optional]="true" hint="Shown struck through next to the price.">
              <input id="pc-list" class="cf-input" inputmode="decimal" formControlName="listPrice" [attr.aria-describedby]="describedBy('pc-list', priceForm.controls.listPrice, true)" />
            </ci-field>
            <ci-field label="Setup fee (₹)" for="pc-setup" [control]="priceForm.controls.setupFee" [optional]="true">
              <input id="pc-setup" class="cf-input" inputmode="decimal" formControlName="setupFee" [attr.aria-describedby]="describedBy('pc-setup', priceForm.controls.setupFee)" />
            </ci-field>
          </div>
          @if (plan(); as pl) {
            @if (pl.prices.length) {
              <div>
                <strong>Price history</strong>
                <ul class="hist">
                  @for (pr of pl.prices; track pr.id) { <li>{{ cycle(pr.billingCycle) }}: {{ money(pr.price) }} (renews {{ money(pr.renewalPrice) }}) — {{ pr.current ? 'current' : 'earlier' }}</li> }
                </ul>
              </div>
            }
          }
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="close()">Cancel</button>
          <button type="submit" form="price-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Set Price' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class ProductsPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminContentApi);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly describedBy = describedBy;
  private readonly auth = inject(AuthService);
  protected readonly canWrite = computed(() => this.auth.can('products:write'));
  protected readonly typeKeys = Object.keys(TYPES);
  protected readonly cycleKeys: BillingCycle[] = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'BIENNIAL', 'TRIENNIAL', 'ONE_TIME'];
  protected readonly products = signal<AdminProduct[]>([]);
  protected readonly categories = signal<{ slug: string; name: string }[]>([]);
  protected readonly loading = signal(true);
  protected readonly dlg = signal<Dlg>(null);
  protected readonly editProduct = signal<AdminProduct | null>(null);
  protected readonly target = signal<AdminProduct | null>(null);
  protected readonly plan = signal<AdminPlan | null>(null);

  protected typeLabel = (t: string) => TYPES[t] ?? t;
  protected statusLabel = (s: keyof typeof STATUS_LABEL) => STATUS_LABEL[s];
  protected statusBadge = (s: keyof typeof STATUS_BADGE) => STATUS_BADGE[s];
  protected cycle = (c: BillingCycle) => CYCLE_LABEL[c];
  protected money = (n: number) => formatMoney(n);
  protected current = (pl: AdminPlan) => pl.prices.filter((p) => p.current);

  protected readonly productForm = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(160)]],
    slug: ['', [Validators.required, Validators.pattern(SLUG)]],
    type: ['WEB_HOSTING'],
    categorySlug: ['', Validators.required],
    tagline: [''],
    description: [''],
    status: ['DRAFT' as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'],
  });
  protected readonly planForm = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    slug: ['', [Validators.required, Validators.pattern(SLUG)]],
    description: [''],
    isFeatured: [false],
    status: ['DRAFT' as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'],
  });
  protected readonly featForm = this.fb.group({ text: [''] });
  protected readonly priceForm = this.fb.group({
    billingCycle: ['YEARLY' as BillingCycle],
    price: ['', [Validators.required, MONEY]],
    renewalPrice: ['', [Validators.required, MONEY]],
    listPrice: ['', OPT_MONEY],
    setupFee: ['', OPT_MONEY],
  });

  async ngOnInit() {
    await Promise.all([this.load(), this.loadCategories()]);
  }

  private async loadCategories() {
    try {
      const cats = (await this.api.categories()).data;
      this.categories.set(cats);
      // The dialog may already be open (or opened before this arrived): make sure a category is chosen.
      if (!this.productForm.controls.categorySlug.value) this.productForm.controls.categorySlug.setValue(cats[0]?.slug ?? '');
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  private async load() {
    try {
      this.products.set((await this.api.products()).data);
      // Keep an open dialog's plan fresh after saving.
      const open = this.plan();
      if (open) this.plan.set(this.products().flatMap((p) => p.plans).find((p) => p.id === open.id) ?? null);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected close() {
    this.dlg.set(null);
    this.error.set(null);
    this.plan.set(null);
  }

  protected suggestSlug(f: { controls: { name: { value: string }; slug: { value: string; setValue(v: string): void } } }) {
    const c = f.controls;
    if (!c.slug.value && !this.editProduct() && this.dlg() !== 'editPlan') c.slug.setValue(slugify(c.name.value));
  }

  // ---- product
  protected openProduct(p?: AdminProduct) {
    this.error.set(null);
    this.editProduct.set(p ?? null);
    this.productForm.reset({
      name: p?.name ?? '', slug: p?.slug ?? '', type: p?.type ?? 'WEB_HOSTING', categorySlug: p?.category.slug ?? this.categories()[0]?.slug ?? '',
      tagline: p?.tagline ?? '', description: p?.description ?? '', status: p?.status ?? 'DRAFT',
    });
    if (p) this.productForm.controls.slug.disable();
    else this.productForm.controls.slug.enable();
    this.dlg.set('product');
    if (!this.categories().length) void this.loadCategories();
  }

  protected async saveProduct() {
    this.productForm.markAllAsTouched();
    if (this.productForm.invalid) return;
    const v = this.productForm.getRawValue();
    const cur = this.editProduct();
    const ok = await this.run(async () => {
      const common = { name: v.name, tagline: v.tagline, description: v.description, status: v.status };
      if (cur) await this.api.updateProduct(cur.id, common);
      else await this.api.createProduct({ ...common, slug: v.slug, type: v.type, categorySlug: v.categorySlug });
    });
    if (ok) {
      this.close();
      this.toast.set('Product saved.');
      await this.load();
    }
  }

  // ---- plan
  protected openPlan(p: AdminProduct) {
    this.error.set(null);
    this.target.set(p);
    this.planForm.reset({ name: '', slug: '', description: '', isFeatured: false, status: 'DRAFT' });
    this.planForm.controls.slug.enable();
    this.dlg.set('plan');
  }

  protected openEditPlan(p: AdminProduct, pl: AdminPlan) {
    this.error.set(null);
    this.target.set(p);
    this.plan.set(pl);
    this.planForm.reset({ name: pl.name, slug: pl.slug, description: pl.description ?? '', isFeatured: pl.isFeatured, status: pl.status });
    this.planForm.controls.slug.disable();
    this.dlg.set('editPlan');
  }

  protected async savePlan() {
    this.planForm.markAllAsTouched();
    if (this.planForm.invalid) return;
    const v = this.planForm.getRawValue();
    const prod = this.target();
    const cur = this.plan();
    const ok = await this.run(async () => {
      const common = { name: v.name, description: v.description, isFeatured: v.isFeatured };
      if (this.dlg() === 'editPlan' && cur) await this.api.updatePlan(cur.id, { ...common, status: v.status });
      else if (prod) await this.api.createPlan(prod.id, { ...common, slug: v.slug });
    });
    if (ok) {
      this.close();
      this.toast.set('Plan saved.');
      await this.load();
    }
  }

  // ---- features
  protected openFeatures(pl: AdminPlan) {
    this.error.set(null);
    this.plan.set(pl);
    this.featForm.reset({ text: pl.features.map((f) => `${f.highlight ? '* ' : ''}${f.label}${f.value ? ` | ${f.value}` : ''}`).join('\n') });
    this.dlg.set('features');
  }

  protected async saveFeatures() {
    const pl = this.plan();
    if (!pl) return;
    const features = lines(this.featForm.controls.text.value).map((l) => {
      const highlight = l.startsWith('*');
      const [label, ...rest] = l.replace(/^\*\s*/, '').split('|');
      return { label: (label ?? '').trim(), value: rest.join('|').trim() || null, highlight };
    });
    if (features.some((f) => !f.label)) {
      this.error.set('Each line needs some text before the “|”.');
      return;
    }
    const ok = await this.run(() => this.api.setFeatures(pl.id, features));
    if (ok) {
      this.close();
      this.toast.set('Features saved.');
      await this.load();
    }
  }

  // ---- price
  protected openPrice(pl: AdminPlan) {
    this.error.set(null);
    this.plan.set(pl);
    this.priceForm.reset({ billingCycle: 'YEARLY', price: '', renewalPrice: '', listPrice: '', setupFee: '' });
    this.dlg.set('price');
  }

  protected async savePrice() {
    this.priceForm.markAllAsTouched();
    if (this.priceForm.invalid) return;
    const pl = this.plan();
    if (!pl) return;
    const v = this.priceForm.getRawValue();
    const body = { billingCycle: v.billingCycle, price: num(v.price), renewalPrice: num(v.renewalPrice), listPrice: num(v.listPrice), setupFee: num(v.setupFee) ?? 0 };
    const ok = await this.run(
      async () => {
        await this.api.addPrice(pl.id, body);
      },
      (message, fields) => this.error.set(fields['listPrice'] ?? message),
    );
    if (ok) {
      this.close();
      this.toast.set('Price set. It is live now for published plans.');
      await this.load();
    }
  }
}
