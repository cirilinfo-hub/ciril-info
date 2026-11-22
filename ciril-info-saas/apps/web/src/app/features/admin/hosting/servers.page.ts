import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';

export interface HostingServerRow {
  id: string;
  name: string;
  hostname: string;
  ipAddress: string;
  panel: 'CPANEL' | 'PLESK';
  port: number | null;
  username: string | null;
  tls: 'verify' | 'skip' | 'off';
  location: string | null;
  status: 'ACTIVE' | 'MAINTENANCE' | 'FULL' | 'RETIRED';
  maxAccounts: number;
  nameservers: string[];
  lastCheckedAt: string | null;
  lastCheck: string | null;
  credentialsSet: boolean;
  accounts: number;
}

const STATUS: Record<HostingServerRow['status'], { label: string; cls: string }> = {
  ACTIVE: { label: 'Taking new accounts', cls: 'cf-badge-success' },
  MAINTENANCE: { label: 'Maintenance', cls: 'cf-badge-warning' },
  FULL: { label: 'Full', cls: 'cf-badge-neutral' },
  RETIRED: { label: 'Retired', cls: 'cf-badge-neutral' },
};

/** Hosting servers that new accounts are spread over (HOSTING_PROVIDER=servers). Credentials are write-only. */
@Component({
  selector: 'ci-admin-servers',
  imports: [DatePipe, ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .two { display: grid; gap: var(--space-4); grid-template-columns: 1fr; }
    @media (min-width: 520px) { .two { grid-template-columns: 1fr 1fr; } }
    td small { display: block; color: var(--color-text-secondary); }
    td.num { text-align: right; white-space: nowrap; }
    .row-actions { text-align: right; white-space: nowrap; }
    .ok { color: var(--color-text-success, #067647); }
    .bad { color: var(--color-text-danger, #b42318); }
  `,
  template: `
    <ci-page-head title="Hosting servers" sub="The cPanel and Plesk servers new hosting accounts are placed on. Each new account goes to the active server with the most room.">
      @if (canWrite()) { <button type="button" class="cf-btn cf-btn-primary" (click)="openNew()"><ci-icon name="plus" [size]="16" />Add server</button> }
    </ci-page-head>
    @if (!inUse() && loaded()) { <div class="cf-alert cf-alert-info" data-testid="not-in-use"><ci-icon name="info" /><span>These servers are used when HOSTING_PROVIDER=servers is set on the server. Right now hosting uses another setting, so this list is not used yet.</span></div> }
    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !formOpen(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Server</th><th scope="col">Panel</th><th scope="col" class="num">Accounts</th><th scope="col">Status</th><th scope="col">Last check</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (s of rows(); track s.id) {
            <tr>
              <td>{{ s.name }}<small>{{ s.hostname }} · {{ s.ipAddress }}@if (s.location) { · {{ s.location }} }</small></td>
              <td>{{ s.panel === 'CPANEL' ? 'cPanel/WHM' : 'Plesk' }}@if (!s.credentialsSet) { <small class="bad">No credentials saved</small> }</td>
              <td class="num">{{ s.accounts }} / {{ s.maxAccounts }}</td>
              <td><span class="cf-badge" [class]="'cf-badge ' + status(s).cls">{{ status(s).label }}</span></td>
              <td>@if (s.lastCheck) { <span [class.ok]="s.lastCheck.startsWith('Connected')" [class.bad]="!s.lastCheck.startsWith('Connected')" data-testid="last-check">{{ s.lastCheck }}</span><small>{{ s.lastCheckedAt | date: 'd MMM y, h:mm a' }}</small> } @else { Not tested }</td>
              <td class="row-actions">
                @if (canTest()) { <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="busy()" (click)="test(s)" [attr.aria-label]="'Test the connection to ' + s.name">Test connection</button> }
                @if (canWrite()) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="openEdit(s)" [attr.aria-label]="'Edit ' + s.name">Edit</button> }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6">@if (!loaded()) { <span class="ci-skeleton"></span> } @else { No servers yet. }</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (formOpen()) {
      <ci-dialog [heading]="editing() ? 'Edit ' + editing()!.name : 'Add server'" description="The API credentials are stored encrypted and never shown again. Leave the credentials empty when editing to keep the saved ones." icon="globe" size="md" [dismissable]="false" (closed)="formOpen.set(false)">
        <form id="srv-form" [formGroup]="form" (ngSubmit)="save()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <div class="two">
            <ci-field label="Name" for="sv-name" [control]="form.controls.name" [required]="true" hint="For your team, e.g. Mumbai 1.">
              <input id="sv-name" class="cf-input" formControlName="name" [attr.aria-describedby]="describedBy('sv-name', form.controls.name, true)" />
            </ci-field>
            <ci-field label="Panel" for="sv-panel" [control]="form.controls.panel" [required]="true">
              <select id="sv-panel" class="cf-input" formControlName="panel" [attr.aria-describedby]="describedBy('sv-panel', form.controls.panel)">
                <option value="CPANEL">cPanel/WHM</option><option value="PLESK">Plesk</option>
              </select>
            </ci-field>
          </div>
          <div class="two">
            <ci-field label="Server address" for="sv-host" [control]="form.controls.hostname" [required]="true" errorLabel="the server's name, e.g. server1.yourhost.com">
              <input id="sv-host" class="cf-input" autocomplete="off" formControlName="hostname" [attr.aria-describedby]="describedBy('sv-host', form.controls.hostname)" />
            </ci-field>
            <ci-field label="Shared IPv4 address" for="sv-ip" [control]="form.controls.ipAddress" [required]="true" errorLabel="an IPv4 address">
              <input id="sv-ip" class="cf-input" autocomplete="off" formControlName="ipAddress" [attr.aria-describedby]="describedBy('sv-ip', form.controls.ipAddress)" />
            </ci-field>
          </div>
          <div class="two">
            @if (form.controls.panel.value === 'CPANEL') {
              <ci-field label="WHM user" for="sv-user" [control]="form.controls.username" [optional]="true" hint="The user the API token belongs to. Usually root.">
                <input id="sv-user" class="cf-input" autocomplete="off" formControlName="username" [attr.aria-describedby]="describedBy('sv-user', form.controls.username, true)" />
              </ci-field>
            }
            <ci-field label="Most accounts" for="sv-max" [control]="form.controls.maxAccounts" [required]="true" errorLabel="a number from 1 to 100000">
              <input id="sv-max" class="cf-input" inputmode="numeric" formControlName="maxAccounts" [attr.aria-describedby]="describedBy('sv-max', form.controls.maxAccounts)" />
            </ci-field>
          </div>
          <ci-field [label]="form.controls.panel.value === 'CPANEL' ? 'WHM API token' : 'Plesk API key'" for="sv-secret" [control]="form.controls.secret" [required]="!editing()" [optional]="!!editing()" [hint]="editing() ? 'Leave empty to keep the saved one.' : 'Stored encrypted. Never shown again.'">
            <input id="sv-secret" class="cf-input" type="password" autocomplete="new-password" formControlName="secret" [attr.aria-describedby]="describedBy('sv-secret', form.controls.secret, true)" />
          </ci-field>
          <div class="two">
            <ci-field label="Certificate" for="sv-tls" [control]="form.controls.tls">
              <select id="sv-tls" class="cf-input" formControlName="tls" [attr.aria-describedby]="describedBy('sv-tls', form.controls.tls)">
                <option value="verify">Check it (normal)</option><option value="skip">Do not check (self-signed, temporary)</option>
              </select>
            </ci-field>
            @if (editing()) {
              <ci-field label="Status" for="sv-status" [control]="form.controls.status" hint="Only servers taking new accounts get new accounts. Existing accounts keep working.">
                <select id="sv-status" class="cf-input" formControlName="status" [attr.aria-describedby]="describedBy('sv-status', form.controls.status, true)">
                  <option value="ACTIVE">Taking new accounts</option><option value="MAINTENANCE">Maintenance</option><option value="FULL">Full</option><option value="RETIRED">Retired</option>
                </select>
              </ci-field>
            }
          </div>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="formOpen.set(false)">Cancel</button>
          <button type="submit" form="srv-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save server' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class AdminServersPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly base = `${this.auth.api}/admin/hosting-servers`;
  protected readonly describedBy = describedBy;
  protected readonly canWrite = computed(() => this.auth.can('settings:write'));
  protected readonly canTest = computed(() => this.auth.can('hosting:write'));
  protected readonly rows = signal<HostingServerRow[]>([]);
  protected readonly inUse = signal(false);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly toast = signal<string | null>(null);
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<HostingServerRow | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    panel: ['CPANEL' as 'CPANEL' | 'PLESK', [Validators.required]],
    hostname: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9.-]{3,253}$/)]],
    ipAddress: ['', [Validators.required, Validators.pattern(/^(\d{1,3}\.){3}\d{1,3}$/)]],
    username: [''],
    maxAccounts: ['500', [Validators.required, Validators.pattern(/^[1-9]\d{0,5}$/)]],
    secret: [''],
    tls: ['verify' as 'verify' | 'skip' | 'off'],
    status: ['ACTIVE' as HostingServerRow['status']],
  });

  ngOnInit() {
    void this.load();
  }

  protected status(s: HostingServerRow) {
    return STATUS[s.status];
  }

  private async load() {
    try {
      const r = await firstValueFrom(this.http.get<{ inUse: boolean; data: HostingServerRow[] }>(this.base));
      this.rows.set(r.data);
      this.inUse.set(r.inUse);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loaded.set(true);
    }
  }

  protected openNew() {
    this.error.set(null);
    this.editing.set(null);
    this.form.reset({ name: '', panel: 'CPANEL', hostname: '', ipAddress: '', username: 'root', maxAccounts: '500', secret: '', tls: 'verify', status: 'ACTIVE' });
    this.formOpen.set(true);
  }

  protected openEdit(s: HostingServerRow) {
    this.error.set(null);
    this.editing.set(s);
    this.form.reset({ name: s.name, panel: s.panel, hostname: s.hostname, ipAddress: s.ipAddress, username: s.username ?? '', maxAccounts: String(s.maxAccounts), secret: '', tls: s.tls, status: s.status });
    this.form.controls.panel.disable();
    this.formOpen.set(true);
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const editing = this.editing();
    if (!editing && v.secret.length < 8) {
      this.error.set('Enter the API credentials (at least 8 characters).');
      return;
    }
    const body = {
      name: v.name.trim(), hostname: v.hostname.trim().toLowerCase(), ipAddress: v.ipAddress.trim(), maxAccounts: Number(v.maxAccounts), tls: v.tls,
      ...(v.panel === 'CPANEL' ? { username: v.username.trim() || 'root' } : {}), ...(v.secret ? { secret: v.secret } : {}),
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      if (editing) await firstValueFrom(this.http.patch(`${this.base}/${editing.id}`, { ...body, status: v.status }));
      else await firstValueFrom(this.http.post(this.base, { ...body, panel: v.panel }));
      this.formOpen.set(false);
      this.form.controls.panel.enable();
      this.toast.set(editing ? `${body.name} was saved.` : `${body.name} was added. Use Test connection to check it.`);
      await this.load();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async test(s: HostingServerRow) {
    this.busy.set(true);
    this.error.set(null);
    this.toast.set(null);
    try {
      const r = await firstValueFrom(this.http.post<{ ok: boolean; message: string }>(`${this.base}/${s.id}/test`, {}));
      if (r.ok) this.toast.set(`${s.name}: ${r.message}`);
      else this.error.set(`${s.name}: ${r.message}`);
      await this.load();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}
