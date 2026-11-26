import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { AdminContentApi, type SiteClaims } from '../admin-content.api';
import { AdminPage, lines } from '../shared/admin-page';

const toNum = (s: string): number | null => (s.trim() === '' ? null : Number(s));
const orNull = (s: string): string | null => s.trim() || null;

@Component({
  selector: 'ci-admin-claims',
  imports: [ReactiveFormsModule, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-6); max-width: 820px; }
    fieldset { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg, 16px); padding: var(--space-5); margin: 0; display: grid; gap: var(--space-4); }
    legend { padding: 0 var(--space-2); font-weight: 600; }
    .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-4); }
    .lead { max-width: 820px; margin: 0 0 var(--space-5); color: var(--color-text-secondary); }
  `,
  template: `
    <ci-page-head title="Website claims" sub="Guarantees and figures the website may state." />
    <p class="lead">Only fill in what is true and that you can honour. Anything left empty is hidden from the website. Keep these in line with your Refund Policy and SLA pages.</p>

    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    @if (loaded()) {
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <fieldset>
          <legend>Guarantees</legend>
          <div class="two">
            <ci-field label="Uptime guarantee (%)" for="k-up" [control]="form.controls.uptimePercent" [optional]="true" hint="Between 90 and 100, for example 99.9.">
              <input id="k-up" class="cf-input" inputmode="decimal" formControlName="uptimePercent" [attr.aria-describedby]="describedBy('k-up', form.controls.uptimePercent, true)" />
            </ci-field>
            <ci-field label="Money-back period (days)" for="k-mb" [control]="form.controls.moneyBackDays" [optional]="true" hint="For example 30.">
              <input id="k-mb" class="cf-input" inputmode="numeric" formControlName="moneyBackDays" [attr.aria-describedby]="describedBy('k-mb', form.controls.moneyBackDays, true)" />
            </ci-field>
            <ci-field label="Free migration (number of sites)" for="k-mig" [control]="form.controls.freeMigrationSites" [optional]="true">
              <input id="k-mig" class="cf-input" inputmode="numeric" formControlName="freeMigrationSites" [attr.aria-describedby]="describedBy('k-mig', form.controls.freeMigrationSites)" />
            </ci-field>
            <ci-field label="Plans with free migration" for="k-migp" [optional]="true" hint="Plan slugs, one per line.">
              <textarea id="k-migp" class="cf-input" rows="3" formControlName="freeMigrationPlanSlugs" aria-describedby="k-migp-hint"></textarea>
            </ci-field>
          </div>
        </fieldset>
        <fieldset>
          <legend>Support and services</legend>
          <div class="two">
            <ci-field label="Support hours" for="k-sh" [optional]="true" hint="For example: 24/7 chat and email."><input id="k-sh" class="cf-input" formControlName="supportHours" aria-describedby="k-sh-hint" /></ci-field>
            <ci-field label="Typical first response" for="k-rt" [optional]="true" hint="For example: under 15 minutes."><input id="k-rt" class="cf-input" formControlName="supportResponseTime" aria-describedby="k-rt-hint" /></ci-field>
            <ci-field label="SSL warranty wording" for="k-ssl" [optional]="true"><input id="k-ssl" class="cf-input" formControlName="sslWarranty" /></ci-field>
            <ci-field label="Domain transfer time" for="k-dt" [optional]="true" hint="For example: 5–7 days."><input id="k-dt" class="cf-input" formControlName="domainTransferTime" aria-describedby="k-dt-hint" /></ci-field>
            <ci-field label="Data centre locations" for="k-dc" [optional]="true" hint="One per line."><textarea id="k-dc" class="cf-input" rows="3" formControlName="dataCentres" aria-describedby="k-dc-hint"></textarea></ci-field>
          </div>
        </fieldset>
        <fieldset>
          <legend>Hosting: free applications</legend>
          <ci-field label="Applications" for="k-apps" [optional]="true" hint="Up to 60, one per line as “Name | short description” (the description is optional), for example: WordPress | Websites and blogs. List only what your hosting server’s installer really offers.">
            <textarea id="k-apps" class="cf-input" rows="8" formControlName="freeApps" aria-describedby="k-apps-hint"></textarea>
          </ci-field>
          <ci-field label="Note above the list" for="k-apps-note" [optional]="true" hint="For example: Install any of them in one click from your control panel.">
            <input id="k-apps-note" class="cf-input" formControlName="freeAppsNote" aria-describedby="k-apps-note-hint" />
          </ci-field>
        </fieldset>
        <fieldset>
          <legend>Home page figures</legend>
          <ci-field label="Headline figures" for="k-stats" [optional]="true" hint="Up to 4, one per line as “value | label”, for example: 250+ | Projects delivered. Use real, checkable numbers only.">
            <textarea id="k-stats" class="cf-input" rows="4" formControlName="stats" aria-describedby="k-stats-hint"></textarea>
          </ci-field>
        </fieldset>
        @if (canWrite()) { <div><button type="submit" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save Changes' }}</button></div> }
      </form>
    } @else {
      <span class="ci-skeleton"></span>
    }
  `,
})
export class ClaimsPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminContentApi);
  protected readonly describedBy = describedBy;
  private readonly auth = inject(AuthService);
  protected readonly canWrite = computed(() => this.auth.can('content:write'));
  protected readonly loaded = signal(false);

  private static readonly NUM = Validators.pattern(/^\s*\d+(\.\d+)?\s*$|^\s*$/);
  protected readonly form = inject(NonNullableFormBuilder).group({
    uptimePercent: ['', ClaimsPage.NUM],
    moneyBackDays: ['', ClaimsPage.NUM],
    freeMigrationSites: ['', ClaimsPage.NUM],
    freeMigrationPlanSlugs: [''],
    dataCentres: [''],
    supportHours: [''],
    supportResponseTime: [''],
    sslWarranty: [''],
    domainTransferTime: [''],
    freeApps: [''],
    freeAppsNote: [''],
    stats: [''],
  });

  async ngOnInit() {
    try {
      this.fill(await this.api.claims());
      if (!this.canWrite()) this.form.disable();
      this.loaded.set(true);
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  private fill(c: SiteClaims) {
    this.form.reset({
      uptimePercent: c.uptimePercent?.toString() ?? '', moneyBackDays: c.moneyBackDays?.toString() ?? '',
      freeMigrationSites: c.freeMigrationSites?.toString() ?? '', freeMigrationPlanSlugs: c.freeMigrationPlanSlugs.join('\n'),
      dataCentres: c.dataCentres.join('\n'), supportHours: c.supportHours ?? '', supportResponseTime: c.supportResponseTime ?? '',
      sslWarranty: c.sslWarranty ?? '', domainTransferTime: c.domainTransferTime ?? '',
      freeApps: c.freeApps.map((a) => (a.description ? `${a.name} | ${a.description}` : a.name)).join('\n'),
      freeAppsNote: c.freeAppsNote ?? '',
      stats: c.stats.map((s) => `${s.value} | ${s.label}`).join('\n'),
    });
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const stats = lines(v.stats).map((l) => {
      const [value, ...rest] = l.split('|');
      return { value: (value ?? '').trim(), label: rest.join('|').trim() };
    });
    if (stats.some((s) => !s.value || !s.label)) {
      this.error.set('Write each figure as “value | label”, for example “250+ | Projects delivered”.');
      return;
    }
    const freeApps = lines(v.freeApps).map((l) => {
      const [name, ...rest] = l.split('|');
      return { name: (name ?? '').trim(), description: rest.join('|').trim() || null };
    });
    if (freeApps.some((a) => !a.name)) {
      this.error.set('Write each application as “Name | short description”, for example “WordPress | Websites and blogs”.');
      return;
    }
    const body: SiteClaims = {
      uptimePercent: toNum(v.uptimePercent), moneyBackDays: toNum(v.moneyBackDays), freeMigrationSites: toNum(v.freeMigrationSites),
      freeMigrationPlanSlugs: lines(v.freeMigrationPlanSlugs), dataCentres: lines(v.dataCentres), supportHours: orNull(v.supportHours),
      supportResponseTime: orNull(v.supportResponseTime), sslWarranty: orNull(v.sslWarranty), domainTransferTime: orNull(v.domainTransferTime),
      freeApps, freeAppsNote: orNull(v.freeAppsNote), stats,
    };
    const ok = await this.run(async () => {
      this.fill(await this.api.saveClaims(body));
    }, (message, fields) => {
      const first = Object.entries(fields)[0];
      this.error.set(first ? `${message} ${first[1]}` : message);
    });
    if (ok) this.toast.set('Claims saved. The website now shows only what is filled in here.');
  }
}
