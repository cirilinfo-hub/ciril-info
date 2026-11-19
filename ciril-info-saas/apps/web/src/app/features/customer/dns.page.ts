import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Dialog } from '../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../design-system/forms/field';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { type DnsRecordView, type DnsType, DomainsApi } from './domains.api';

interface TypeHelp {
  label: string;
  name: string;
  content: string;
  placeholder: string;
  priority?: string;
}

/** What each record type is for, so nobody has to know DNS to fill the form in. */
const HELP: Record<DnsType, TypeHelp> = {
  A: { label: 'A (address)', name: 'Use @ for the domain itself, or a name such as www.', content: 'An IPv4 address.', placeholder: '203.0.113.10' },
  AAAA: { label: 'AAAA (IPv6 address)', name: 'Use @ for the domain itself, or a name such as www.', content: 'An IPv6 address.', placeholder: '2001:db8::10' },
  CNAME: { label: 'CNAME (alias)', name: 'A name such as www or shop. Not @.', content: 'The host name it should point to.', placeholder: 'target.example.net' },
  MX: { label: 'MX (email)', name: 'Use @ for email at the domain itself.', content: 'The mail server host name.', placeholder: 'mail.example.net', priority: 'Lower numbers are tried first, for example 10.' },
  TXT: { label: 'TXT (text)', name: 'Use @ for the domain itself, or a name such as _dmarc.', content: 'The text, for example an SPF or verification value.', placeholder: 'v=spf1 include:_spf.example.net ~all' },
  NS: { label: 'NS (name server)', name: 'The subdomain you are handing over. Not @.', content: 'The name server host name.', placeholder: 'ns1.example.net' },
  SRV: { label: 'SRV (service)', name: 'Service and protocol, such as _sip._tcp.', content: 'Weight, port and host: "10 5060 sip.example.net".', placeholder: '10 5060 sip.example.net', priority: 'Lower numbers are tried first, for example 5.' },
  CAA: { label: 'CAA (certificate authority)', name: 'Use @ for the domain itself.', content: 'Like: 0 issue "letsencrypt.org".', placeholder: '0 issue "letsencrypt.org"' },
};
const TYPES = Object.keys(HELP) as DnsType[];
const TTLS = [
  { value: 300, label: '5 minutes' },
  { value: 3600, label: '1 hour' },
  { value: 14_400, label: '4 hours' },
  { value: 86_400, label: '1 day' },
];

/** The DNS records of one registered domain. The zone on our servers is the source of truth, so this always shows what is live. */
@Component({
  selector: 'ci-dns',
  imports: [ReactiveFormsModule, RouterLink, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .two { display: grid; gap: var(--space-4); grid-template-columns: 1fr; }
    @media (min-width: 520px) { .two { grid-template-columns: 1fr 1fr; } }
    .back { display: inline-block; margin-bottom: var(--space-3); font-size: 14px; }
    .row-actions { text-align: right; white-space: nowrap; }
    td.content { overflow-wrap: anywhere; max-width: 360px; }
    td small { display: block; color: var(--color-text-secondary); }
    .type { font-weight: 600; }
  `,
  template: `
    <a class="back" [routerLink]="auth.link('/domains')"><ci-icon name="chevron-left" [size]="14" /> Domains</a>
    <ci-page-head title="DNS records" [sub]="domain() ? 'Where ' + domain() + ' points: its website, email and other services. Changes are live straight away.' : ''">
      @if (canWrite() && domain() && !unavailable()) { <button type="button" class="cf-btn cf-btn-primary" (click)="openNew()"><ci-icon name="plus" [size]="16" />Add record</button> }
    </ci-page-head>
    @if (notice(); as n) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ n }}</span></div> }
    @if (error() && !formOpen() && !removing(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    @if (unavailable()) {
      <div class="cf-alert cf-alert-info" role="note"><ci-icon name="info" /><span>DNS for this domain is not set up on our servers yet. Please <a routerLink="/contact">contact us</a> and we will sort it out.</span></div>
    } @else {
      <div class="cf-table-wrap">
        <table class="cf-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Points to</th><th scope="col">TTL</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
          <tbody>
            @for (r of records(); track r.id) {
              <tr>
                <td>{{ r.name }}</td>
                <td class="type">{{ r.type }}</td>
                <td class="content">@if (r.priority != null) { <small>Priority {{ r.priority }}</small> }{{ r.content }}</td>
                <td>{{ ttlLabel(r.ttl) }}</td>
                <td class="row-actions">
                  @if (r.readonly) { <span class="cf-badge cf-badge-neutral">Managed by us</span> }
                  @else if (canWrite()) {
                    <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="openEdit(r)" [attr.aria-label]="'Edit ' + r.type + ' record ' + r.name">Edit</button>
                    <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="removing.set(r)" [attr.aria-label]="'Delete ' + r.type + ' record ' + r.name">Delete</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5">@if (loading()) { <span class="ci-skeleton"></span> } @else { No records yet. }</td></tr>
            }
          </tbody>
        </table>
      </div>
      <p class="cf-help" style="margin-top: var(--space-3)">DNS changes can take a while to reach everyone, depending on each record's TTL. Be careful with MX and name server records: a mistake can stop your email or website.</p>
    }

    @if (formOpen()) {
      <ci-dialog [heading]="editing() ? 'Edit record' : 'Add a record'" [description]="'For ' + domain()" icon="link" size="md" [dismissable]="false" (closed)="formOpen.set(false)">
        <form id="dns-form" [formGroup]="form" (ngSubmit)="save()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Type" for="dns-type" [control]="form.controls.type" [required]="true">
            <select id="dns-type" class="cf-input" formControlName="type" [attr.aria-describedby]="describedBy('dns-type', form.controls.type)">
              @for (t of types; track t) { <option [value]="t">{{ help[t].label }}</option> }
            </select>
          </ci-field>
          <ci-field label="Name" for="dns-name" [control]="form.controls.name" [required]="true" errorLabel="a name, such as www, or @ for the domain itself" [hint]="current().name">
            <input id="dns-name" class="cf-input" autocomplete="off" autocapitalize="off" spellcheck="false" formControlName="name" [attr.aria-describedby]="describedBy('dns-name', form.controls.name, true)" />
          </ci-field>
          <ci-field label="Points to" for="dns-content" [control]="form.controls.content" [required]="true" errorLabel="what it points to" [hint]="current().content">
            <input id="dns-content" class="cf-input" autocomplete="off" autocapitalize="off" spellcheck="false" [placeholder]="current().placeholder" formControlName="content" [attr.aria-describedby]="describedBy('dns-content', form.controls.content, true)" />
          </ci-field>
          <div class="two">
            @if (current().priority; as ph) {
              <ci-field label="Priority" for="dns-prio" [control]="form.controls.priority" [required]="true" errorLabel="a whole number, such as 10" [hint]="ph">
                <input id="dns-prio" class="cf-input" inputmode="numeric" formControlName="priority" [attr.aria-describedby]="describedBy('dns-prio', form.controls.priority, true)" />
              </ci-field>
            }
            <ci-field label="TTL" for="dns-ttl" [control]="form.controls.ttl" hint="How long others may remember it.">
              <select id="dns-ttl" class="cf-input" formControlName="ttl" [attr.aria-describedby]="describedBy('dns-ttl', form.controls.ttl, true)">
                @for (t of ttlOptions(); track t.value) { <option [ngValue]="t.value">{{ t.label }}</option> }
              </select>
            </ci-field>
          </div>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="formOpen.set(false)">Cancel</button>
          <button type="submit" form="dns-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : editing() ? 'Save changes' : 'Add record' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (removing(); as r) {
      <ci-dialog heading="Delete this record?" [description]="'The ' + r.type + ' record for ' + r.name + ' (' + r.content + ') is removed from the live zone.'" icon="warning" tone="danger" [dismissable]="false" (closed)="removing.set(null)">
        @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="removing.set(null)">Keep it</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy()" (click)="remove(r)">{{ busy() ? 'Deleting…' : 'Delete record' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class DnsPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(DomainsApi);
  protected readonly describedBy = describedBy;
  protected readonly help = HELP;
  protected readonly types = TYPES;
  /** From the address: /domains/:id/dns. */
  readonly id = input.required<string>();

  protected readonly domain = signal('');
  protected readonly records = signal<DnsRecordView[]>([]);
  protected readonly loading = signal(true);
  protected readonly unavailable = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<DnsRecordView | null>(null);
  protected readonly removing = signal<DnsRecordView | null>(null);
  protected readonly canWrite = computed(() => this.auth.can('services:manage'));
  protected readonly form = inject(NonNullableFormBuilder).group({
    type: ['A' as DnsType, [Validators.required]],
    name: ['', [Validators.required, Validators.maxLength(255)]],
    content: ['', [Validators.required, Validators.maxLength(2100)]],
    priority: [''],
    ttl: [3600],
  });
  private readonly typeNow = signal<DnsType>('A');
  protected readonly current = computed(() => HELP[this.typeNow()]);
  protected readonly ttlOptions = computed(() => {
    const t = this.form.controls.ttl.value;
    return TTLS.some((x) => x.value === t) ? TTLS : [...TTLS, { value: t, label: this.ttlLabel(t) }].sort((a, b) => a.value - b.value);
  });

  constructor() {
    this.form.controls.type.valueChanges.subscribe((t) => this.typeNow.set(t));
  }

  ngOnInit() {
    return this.load();
  }

  protected ttlLabel(s: number) {
    const known = TTLS.find((x) => x.value === s);
    if (known) return known.label;
    return s % 3600 === 0 ? `${s / 3600} hours` : s % 60 === 0 ? `${s / 60} minutes` : `${s} seconds`;
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.dns(this.id());
      this.domain.set(r.domain);
      this.records.set(r.records);
      this.unavailable.set(false);
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'DNS_NOT_AVAILABLE') this.unavailable.set(true);
      else this.error.set(err.message);
    } finally {
      this.loading.set(false);
    }
  }

  protected openNew() {
    this.error.set(null);
    this.editing.set(null);
    this.form.reset({ type: 'A', name: '', content: '', priority: '', ttl: 3600 });
    this.typeNow.set('A');
    this.form.controls.type.enable();
    this.formOpen.set(true);
  }

  protected openEdit(r: DnsRecordView) {
    this.error.set(null);
    this.editing.set(r);
    this.form.reset({ type: r.type, name: r.name, content: r.content, priority: r.priority != null ? String(r.priority) : '', ttl: r.ttl });
    this.typeNow.set(r.type);
    // The type of an existing record is fixed; delete and add a new one to change it.
    this.form.controls.type.disable();
    this.formOpen.set(true);
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const body = { type: v.type, name: v.name.trim(), content: v.content.trim(), ttl: Number(v.ttl), ...(v.priority.trim() !== '' ? { priority: Number(v.priority) } : {}) };
    const existing = this.editing();
    this.busy.set(true);
    this.error.set(null);
    try {
      if (existing) await this.api.updateDns(this.id(), existing.id, body);
      else await this.api.addDns(this.id(), body);
      this.formOpen.set(false);
      this.notice.set(existing ? 'The record was changed.' : 'The record was added.');
      await this.load();
    } catch (e) {
      const err = toApiError(e);
      this.error.set(err.message);
      // Someone else changed the zone: show what is there now.
      if (err.code === 'DNS_RECORD_CHANGED') await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(r: DnsRecordView) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.removeDns(this.id(), r.id);
      this.removing.set(null);
      this.notice.set('The record was deleted.');
      await this.load();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}
