import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Dialog } from '../../design-system/dialogs/dialog';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import type { DomainResult, DomainSearchResponse } from '../public/shared/public-api';
import { money } from './billing.api';
import { type CustomerDomain, type DomainContact, DOMAIN_STAGE, type DomainQuote, DomainsApi, type RenewalQuote, type TransferQuote } from './domains.api';

const YEARS = [1, 2, 3, 4, 5];

/** The organisation's domains: search for a name, register it (an invoice is issued), and follow it until it is registered. */
@Component({
  selector: 'ci-domains',
  imports: [DatePipe, FormsModule, RouterLink, Dialog, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    section { margin-bottom: var(--space-6); }
    h2 { margin: 0 0 var(--space-3); }
    .search { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    .search .field { flex: 1 1 260px; }
    .search input { width: 100%; height: 48px; }
    .search button { height: 48px; }
    .results { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; gap: var(--space-3); }
    .hit { flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3) var(--space-5); border: 1px solid var(--color-border-subtle); padding: var(--space-3) var(--space-5); }
    .hit.exact { border-color: var(--violet-500, #6d4aff); }
    .name { font-weight: 700; overflow-wrap: anywhere; }
    .end { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
    .price { text-align: right; line-height: 20px; font-size: 14px; }
    .price strong { display: block; font-size: 16px; }
    .price small { color: var(--color-text-secondary); }
    td small { display: block; color: var(--color-text-secondary); }
    .row-actions { text-align: right; white-space: nowrap; }
    .contact-form { display: grid; gap: var(--space-3); }
    .contact-form label:not(.cf-check) { display: grid; gap: var(--space-1); font-size: 14px; }
    .contact-form .two { display: grid; gap: var(--space-3); grid-template-columns: 1fr; }
    @media (min-width: 520px) { .contact-form .two { grid-template-columns: 1fr 1fr; } }
    .code { margin: 0; padding: var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: 8px; font-size: 16px; overflow-wrap: anywhere; user-select: all; }
    .sum { display: grid; gap: var(--space-2); margin: var(--space-4) 0 0; }
    .sum div { display: flex; justify-content: space-between; gap: var(--space-4); }
    .sum .total { font-weight: 700; border-top: 1px solid var(--color-border-subtle); padding-top: var(--space-2); }
    .years { display: grid; gap: var(--space-2); }
    .years select { max-width: 200px; }
    @media (max-width: 560px) { .price { text-align: left; } }
  `,
  template: `
    <ci-page-head title="Domains" sub="Search for a domain name, register it, and see the domains you own." />
    @if (notice(); as n) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ n }}</span></div> }
    @if (error() && !ordering() && !renewing(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <section aria-labelledby="find-h">
      <h2 id="find-h" class="ts-heading-5">Find a domain</h2>
      <div class="cf-card">
        <form class="search" role="search" aria-label="Domain search" (submit)="$event.preventDefault(); search(term())">
          <div class="field">
            <label for="d-search" class="cx-sr">Search for a domain name</label>
            <input id="d-search" class="cf-input" type="search" name="q" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url" maxlength="253" placeholder="yourbusiness or yourbusiness.com" [ngModel]="term()" (ngModelChange)="term.set($event)" />
          </div>
          <button type="submit" class="cf-btn cf-btn-primary" [disabled]="searching()">{{ searching() ? 'Searching…' : 'Search' }}</button>
        </form>

        @if (result(); as r) {
          @if (!r.valid) {
            <div class="cf-alert cf-alert-warning" role="alert" style="margin-top: var(--space-4)"><ci-icon name="info" /><span>That does not look like a domain name. Use letters, numbers and hyphens, for example yourbusiness or yourbusiness.com.</span></div>
          } @else {
            @if (r.unsupportedTld; as t) { <div class="cf-alert cf-alert-info" role="note" style="margin-top: var(--space-4)"><ci-icon name="info" /><span>We do not sell .{{ t }} domains yet. Here are the endings we do offer.</span></div> }
            @if (!r.registrarOk) { <div class="cf-alert cf-alert-warning" role="alert" style="margin-top: var(--space-4)"><ci-icon name="info" /><span>We could not check availability just now. Please try again in a moment.</span></div> }
            @if (!r.results.length) {
              <p style="margin-top: var(--space-4)">Domain prices have not been published yet. Please contact us and we will check this name for you.</p>
            } @else {
              <ul class="results" aria-label="Domain results">
                @for (d of r.results; track d.domain) {
                  <li class="cf-card hit" [class.exact]="d.exact">
                    <span class="name">{{ d.domain }}</span>
                    <span class="end">
                      <span class="cf-badge" [class]="'cf-badge ' + badge(d).cls">{{ badge(d).label }}</span>
                      @if (d.status === 'AVAILABLE') {
                        <span class="price"><strong>{{ money(d.registerPrice) }}</strong><small>first year · renews {{ money(d.renewPrice) }}</small></span>
                        @if (auth.can('services:manage')) { <button type="button" class="cf-btn cf-btn-primary cf-btn-sm" (click)="openOrder(d.domain)" [attr.aria-label]="'Register ' + d.domain">Register</button> }
                      }
                    </span>
                  </li>
                }
              </ul>
              @if (!auth.can('services:manage')) { <p class="cf-help" style="margin-top: var(--space-3)">Ask an owner or admin of your organisation to register a domain.</p> }
            }
          }
        }
      </div>
    </section>

    <section id="transfer" aria-labelledby="xfer-h">
      <h2 id="xfer-h" class="ts-heading-5">Transfer a domain to us</h2>
      <div class="cf-card">
        <p class="cf-help" style="margin: 0 0 var(--space-3)">Already own a domain somewhere else? Bring it to us. Its registration is extended by a year. You need its authorisation code (also called an EPP code) from your current registrar.</p>
        <form class="search" aria-label="Transfer a domain" (submit)="$event.preventDefault(); checkTransfer()">
          <div class="field">
            <label for="t-domain" class="cx-sr">Domain to transfer</label>
            <input id="t-domain" class="cf-input" name="tdomain" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url" maxlength="253" placeholder="yourdomain.com" [ngModel]="xferDomain()" (ngModelChange)="xferDomain.set($event)" />
          </div>
          <div class="field">
            <label for="t-code" class="cx-sr">Authorisation code</label>
            <input id="t-code" class="cf-input" name="tcode" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="128" placeholder="Authorisation code" [ngModel]="xferCode()" (ngModelChange)="xferCode.set($event)" />
          </div>
          <button type="submit" class="cf-btn cf-btn-primary" [disabled]="xferChecking() || !auth.can('services:manage')">{{ xferChecking() ? 'Checking…' : 'Check and continue' }}</button>
        </form>
        @if (xferError(); as e) { <div class="cf-alert cf-alert-error" role="alert" style="margin-top: var(--space-4)"><ci-icon name="error" /><span>{{ e }}</span></div> }
      </div>
    </section>

    <section aria-labelledby="mine-h">
      <h2 id="mine-h" class="ts-heading-5">Your domains</h2>
      <div class="cf-table-wrap">
        <table class="cf-table">
          <thead><tr><th scope="col">Domain</th><th scope="col">Status</th><th scope="col">Expires</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
          <tbody>
            @for (d of domains(); track d.id) {
              <tr>
                <td>{{ d.name }}<small>{{ d.years }} {{ d.years === 1 ? 'year' : 'years' }}</small></td>
                <td>
                  <span class="cf-badge" [class]="'cf-badge ' + stage(d).cls">{{ stage(d).label }}</span>
                  <small>{{ d.stage === 'FAILED' && d.failureReason ? d.failureReason + ' We will refund your payment.' : stage(d).hint }}</small>
                  @if (d.contactChanges?.length) {
                    <small data-testid="contact-change">Contact details change asked for. We will email you when it is done.</small>
                  }
                  @if (d.nameserverChanges?.[0]; as nc) {
                    <small data-testid="nameserver-change">Changing nameservers to {{ nc.nameservers.join(', ') }}. We will email you when it is done.</small>
                  }
                  @if (d.transferOuts?.[0]; as out) {
                    <small data-testid="transfer-out">{{ out.status === 'RELEASED' ? 'Unlocked for transfer. Show the code and give it to your new registrar.' : 'Transfer to another registrar asked for. We are unlocking it and getting its code, and will email you.' }}</small>
                  }
                  @if (d.renewal; as rn) {
                    <small>{{ rn.stage === 'AWAITING_PAYMENT' ? 'Renewal for ' + rn.years + (rn.years === 1 ? ' year' : ' years') + ' is awaiting payment.' : 'Renewal paid. Our team is renewing it and will email you when it is done.' }}</small>
                  }
                </td>
                <td>{{ d.expiresAt ? (d.expiresAt | date: 'd MMM y') : '—' }}</td>
                <td class="row-actions">
                  @if (d.stage === 'ACTIVE') { <a class="cf-btn cf-btn-tertiary cf-btn-sm" [routerLink]="[auth.link('/domains'), d.id, 'dns']" [attr.aria-label]="'Manage DNS for ' + d.name">DNS</a> }
                  @if (d.renewal?.stage === 'AWAITING_PAYMENT') {
                    @if (auth.can('billing:read')) { <a class="cf-btn cf-btn-primary cf-btn-sm" [routerLink]="[auth.link('/invoices'), d.renewal!.invoice.id]" [attr.aria-label]="'Pay the renewal for ' + d.name">Pay renewal</a> }
                    @if (auth.can('services:manage')) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="cancelRenewalFor.set(d)" [attr.aria-label]="'Cancel the renewal for ' + d.name">Cancel renewal</button> }
                  } @else if (!d.renewal && !d.transferOuts?.length && (d.stage === 'ACTIVE' || d.stage === 'EXPIRED') && auth.can('services:manage')) {
                    <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="busy()" (click)="openRenew(d)" [attr.aria-label]="'Renew ' + d.name">Renew</button>
                  }
                  @if (d.stage === 'ACTIVE' && auth.can('services:manage')) {
                    @if (d.contactChanges?.length) {
                      <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="withdrawContacts(d)" [attr.aria-label]="'Withdraw the contact change for ' + d.name">Withdraw contact change</button>
                    } @else {
                      <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="openContacts(d)" [attr.aria-label]="'Change the contacts of ' + d.name">Contacts</button>
                    }
                    @if (d.nameserverChanges?.length) {
                      <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="withdrawNameservers(d)" [attr.aria-label]="'Withdraw the nameserver change for ' + d.name">Withdraw change</button>
                    } @else {
                      <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="openNameservers(d)" [attr.aria-label]="'Change the nameservers of ' + d.name">Nameservers</button>
                    }
                    @if (d.transferOuts?.[0]; as out) {
                      @if (out.status === 'RELEASED') { <button type="button" class="cf-btn cf-btn-primary cf-btn-sm" [disabled]="busy()" (click)="showCode(d)" [attr.aria-label]="'Show the transfer code for ' + d.name">Show code</button> }
                      <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="withdrawFor.set(d)" [attr.aria-label]="'Withdraw the transfer of ' + d.name">Withdraw transfer</button>
                    } @else if (!d.renewal) {
                      <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="outFor.set(d)" [attr.aria-label]="'Transfer ' + d.name + ' to another registrar'">Transfer away</button>
                    }
                  }
                  @if (d.stage === 'TRANSFER_AWAITING_PAYMENT' && d.transfers?.[0]?.invoice; as inv) {
                    @if (auth.can('billing:read')) { <a class="cf-btn cf-btn-primary cf-btn-sm" [routerLink]="[auth.link('/invoices'), inv.id]" [attr.aria-label]="'Pay for the transfer of ' + d.name">Pay now</a> }
                    @if (auth.can('services:manage')) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="cancelFor.set(d)" [attr.aria-label]="'Cancel the transfer of ' + d.name">Cancel order</button> }
                  }
                  @if (d.stage === 'AWAITING_PAYMENT' && d.orderInvoice) {
                    @if (auth.can('billing:read')) { <a class="cf-btn cf-btn-primary cf-btn-sm" [routerLink]="[auth.link('/invoices'), d.orderInvoice.id]" [attr.aria-label]="'Pay for ' + d.name">Pay now</a> }
                    @if (auth.can('services:manage')) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="cancelFor.set(d)" [attr.aria-label]="'Cancel the order for ' + d.name">Cancel order</button> }
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="4">@if (loading()) { <span class="ci-skeleton"></span> } @else { You have no domains yet. Search for a name above to register one. }</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (ordering(); as name) {
      <ci-dialog [heading]="'Register ' + name" description="You will get an invoice to pay. Once it is paid, our team registers the domain and emails you." icon="link" size="md" [dismissable]="false" (closed)="ordering.set(null)">
        @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
        <div class="years">
          <label for="d-years" class="cf-label">Register for</label>
          <select id="d-years" class="cf-input" [ngModel]="years()" (ngModelChange)="setYears($event)">
            @for (y of yearOptions; track y) { <option [ngValue]="y">{{ y }} {{ y === 1 ? 'year' : 'years' }}</option> }
          </select>
        </div>
        @if (quote(); as q) {
          <div class="sum" aria-live="polite">
            <div><span>{{ q.domain }} · {{ q.years }} {{ q.years === 1 ? 'year' : 'years' }}</span><span>{{ money(q.subtotal) }}</span></div>
            @if (+q.taxTotal > 0) { <div><span>{{ q.taxName ?? 'Tax' }}</span><span>{{ money(q.taxTotal) }}</span></div> }
            <div class="total"><span>Total</span><span>{{ money(q.total) }}</span></div>
          </div>
        } @else if (quoting()) {
          <div class="ci-skeleton" style="height: 72px; margin-top: var(--space-4)" aria-hidden="true"></div>
        }
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="ordering.set(null)">Cancel</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy() || !quote()" (click)="placeOrder(name)">{{ busy() ? 'Creating invoice…' : 'Continue to payment' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (xferQuote(); as q) {
      <ci-dialog [heading]="'Transfer ' + q.domain" description="You will get an invoice to pay. Once it is paid, our team starts the transfer with your authorisation code, and emails you." icon="swap" size="md" [dismissable]="false" (closed)="xferQuote.set(null)">
        @if (xferError(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
        <div class="sum" aria-live="polite">
          <div><span>{{ q.domain }} · transfer, includes 1 year</span><span>{{ money(q.subtotal) }}</span></div>
          @if (+q.taxTotal > 0) { <div><span>{{ q.taxName ?? 'Tax' }}</span><span>{{ money(q.taxTotal) }}</span></div> }
          <div class="total"><span>Total</span><span>{{ money(q.total) }}</span></div>
        </div>
        <p class="cf-help" style="margin-top: var(--space-4)">Before we start, at your current registrar: unlock the domain, turn off any privacy protection that hides the owner's email (so they can approve the transfer), and make sure it is not within 60 days of being registered or last transferred. If it cannot be transferred we will tell you why and refund you.</p>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="xferQuote.set(null)">Cancel</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy()" (click)="placeTransfer(q)">{{ busy() ? 'Creating invoice…' : 'Continue to payment' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (renewing(); as d) {
      <ci-dialog [heading]="'Renew ' + d.name" description="You will get an invoice to pay. Once it is paid, our team renews the domain at the registrar and emails you." icon="refresh" size="md" [dismissable]="false" (closed)="renewing.set(null)">
        @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
        <div class="years">
          <label for="r-years" class="cf-label">Renew for</label>
          <select id="r-years" class="cf-input" [ngModel]="renewYears()" (ngModelChange)="setRenewYears($event)">
            @for (y of yearOptions; track y) { <option [ngValue]="y">{{ y }} {{ y === 1 ? 'year' : 'years' }}</option> }
          </select>
        </div>
        @if (renewQuote(); as q) {
          <div class="sum" aria-live="polite">
            <div><span>{{ q.domain }} · {{ q.years }} {{ q.years === 1 ? 'year' : 'years' }}</span><span>{{ money(q.subtotal) }}</span></div>
            @if (+q.taxTotal > 0) { <div><span>{{ q.taxName ?? 'Tax' }}</span><span>{{ money(q.taxTotal) }}</span></div> }
            <div class="total"><span>Total</span><span>{{ money(q.total) }}</span></div>
            <div><span>New expiry date</span><span>{{ q.newExpiry | date: 'd MMM y' }}</span></div>
          </div>
        } @else if (renewQuoting()) {
          <div class="ci-skeleton" style="height: 72px; margin-top: var(--space-4)" aria-hidden="true"></div>
        }
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="renewing.set(null)">Cancel</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy() || !renewQuote()" (click)="placeRenewal(d)">{{ busy() ? 'Creating invoice…' : 'Continue to payment' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (cancelRenewalFor(); as d) {
      <ci-dialog heading="Cancel this renewal?" [description]="'The renewal invoice for ' + d.name + ' is cancelled. The domain keeps its current expiry date.'" icon="warning" tone="danger" [dismissable]="false" (closed)="cancelRenewalFor.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="cancelRenewalFor.set(null)">Keep the renewal</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy()" (click)="cancelRenewal(d)">{{ busy() ? 'Cancelling…' : 'Cancel renewal' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (outFor(); as d) {
      <ci-dialog [heading]="'Transfer ' + d.name + ' to another registrar?'" description="We unlock the domain and get its authorisation code, and email you when it is ready (usually within a day). You then give the code to your new registrar, who charges you for the transfer and usually adds a year. Keep your DNS settings noted: they may not move with it." icon="swap" size="md" [dismissable]="false" (closed)="outFor.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="outFor.set(null)">Keep it here</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy()" (click)="transferOut(d)">{{ busy() ? 'Asking…' : 'Get the transfer code' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (codeFor(); as c) {
      <ci-dialog [heading]="'Transfer code for ' + c.d.name" description="Give this code to your new registrar to start the transfer. Keep it private: anyone with it can move your domain." icon="key" size="md" (closed)="codeFor.set(null)">
        <p class="code" data-testid="transfer-code"><code>{{ c.code }}</code></p>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="copyCode(c.code)">{{ copied() ? 'Copied' : 'Copy' }}</button>
          <button type="button" class="cf-btn cf-btn-primary" (click)="codeFor.set(null)">Done</button>
        </ng-container>
      </ci-dialog>
    }

    @if (contactFor(); as d) {
      <ci-dialog [heading]="'Contact details for ' + d.name" description="The registrant is the legal owner of the domain. These details are also used for its admin, technical and billing contacts." icon="user" size="md" [dismissable]="false" (closed)="contactFor.set(null)">
        @if (contact(); as c) {
          <form id="contact-form" class="contact-form" (ngSubmit)="saveContacts(d)" novalidate>
            @if (contactError(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
            <div class="cf-alert cf-alert-warning" data-testid="contact-warning"><ci-icon name="warning" /><span>Changing the name, organisation or email is a change of owner under the registry's rules. The registry may email the old and new addresses to confirm it, and the domain may not be transferable to another registrar for 60 days.</span></div>
            <div class="two">
              <label>First name<input class="cf-input" name="firstName" autocomplete="given-name" [ngModel]="c.firstName" (ngModelChange)="setContact('firstName', $event)" /></label>
              <label>Last name<input class="cf-input" name="lastName" autocomplete="family-name" [ngModel]="c.lastName" (ngModelChange)="setContact('lastName', $event)" /></label>
            </div>
            <label>Organisation (optional)<input class="cf-input" name="organisation" autocomplete="organization" [ngModel]="c.organisation ?? ''" (ngModelChange)="setContact('organisation', $event)" /></label>
            <div class="two">
              <label>Email<input class="cf-input" name="email" type="email" autocomplete="email" [ngModel]="c.email" (ngModelChange)="setContact('email', $event)" /></label>
              <label>Phone<input class="cf-input" name="phone" type="tel" autocomplete="tel" [ngModel]="c.phone" (ngModelChange)="setContact('phone', $event)" /></label>
            </div>
            <label>Address<input class="cf-input" name="address1" autocomplete="address-line1" [ngModel]="c.address1" (ngModelChange)="setContact('address1', $event)" /></label>
            <label>Address line 2 (optional)<input class="cf-input" name="address2" autocomplete="address-line2" [ngModel]="c.address2 ?? ''" (ngModelChange)="setContact('address2', $event)" /></label>
            <div class="two">
              <label>City<input class="cf-input" name="city" autocomplete="address-level2" [ngModel]="c.city" (ngModelChange)="setContact('city', $event)" /></label>
              <label>State<input class="cf-input" name="state" autocomplete="address-level1" [ngModel]="c.state" (ngModelChange)="setContact('state', $event)" /></label>
            </div>
            <div class="two">
              <label>PIN / postal code<input class="cf-input" name="postalCode" autocomplete="postal-code" [ngModel]="c.postalCode" (ngModelChange)="setContact('postalCode', $event)" /></label>
              <label>Country code<input class="cf-input" name="country" maxlength="2" autocomplete="country" [ngModel]="c.country" (ngModelChange)="setContact('country', $event)" /></label>
            </div>
            <label class="cf-check"><input type="checkbox" name="ack" [checked]="contactAck()" (change)="contactAck.set($any($event.target).checked)" /><span>I understand the registry may ask me to confirm this, and the domain may be locked against transfer for 60 days.</span></label>
          </form>
        } @else { <span class="ci-skeleton" style="height:240px"></span> }
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="contactFor.set(null)">Cancel</button>
          <button type="submit" form="contact-form" class="cf-btn cf-btn-primary" [disabled]="busy() || !contact()">{{ busy() ? 'Saving…' : 'Change contacts' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (nsFor(); as d) {
      <ci-dialog [heading]="'Nameservers for ' + d.name" description="Nameservers decide where the domain's DNS records live, and so where your website and email point. Change them only if your new host or website builder asks you to." icon="globe" size="md" [dismissable]="false" (closed)="nsFor.set(null)">
        <form id="ns-form" (ngSubmit)="saveNameservers(d)" novalidate>
          @if (nsError(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <p class="cf-help">Now: {{ d.nameservers?.length ? d.nameservers!.join(', ') : 'not recorded here yet (the ones set when it was registered or transferred).' }}</p>
          <label for="ns-list" class="ts-body-sm">New nameservers, one per line</label>
          <textarea id="ns-list" name="nameservers" class="cf-input" rows="4" autocomplete="off" spellcheck="false" [ngModel]="nsText()" (ngModelChange)="nsText.set($event)" aria-describedby="ns-hint"></textarea>
          <p id="ns-hint" class="cf-help">At least two, for example ns1.yourhost.com and ns2.yourhost.com. Changes take up to a day or two to be seen everywhere.</p>
          @if (nsDefaults().length) { <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" (click)="nsText.set(nsDefaults().join('\n'))">Use our nameservers</button> }
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="nsFor.set(null)">Cancel</button>
          <button type="submit" form="ns-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Change nameservers' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (withdrawFor(); as d) {
      <ci-dialog heading="Withdraw this transfer?" [description]="d.name + ' stays with us and is locked again. The transfer code stops working once it is locked.'" icon="warning" tone="danger" [dismissable]="false" (closed)="withdrawFor.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="withdrawFor.set(null)">Keep transferring</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy()" (click)="withdraw(d)">{{ busy() ? 'Withdrawing…' : 'Withdraw transfer' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (cancelFor(); as d) {
      <ci-dialog heading="Cancel this order?" [description]="'The invoice for ' + d.name + ' is cancelled and the name is released for others.'" icon="warning" tone="danger" [dismissable]="false" (closed)="cancelFor.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="cancelFor.set(null)">Keep the order</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy()" (click)="cancel(d)">{{ busy() ? 'Cancelling…' : 'Cancel order' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class DomainsPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(DomainsApi);
  private readonly router = inject(Router);
  protected readonly money = money;
  protected readonly yearOptions = YEARS;
  /** From ?register=name: the public Domains page sends visitors here to carry on. */
  readonly register = input<string>();

  protected readonly term = signal('');
  protected readonly result = signal<DomainSearchResponse | null>(null);
  protected readonly searching = signal(false);
  protected readonly domains = signal<CustomerDomain[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly nsFor = signal<CustomerDomain | null>(null);
  protected readonly contactFor = signal<CustomerDomain | null>(null);
  protected readonly contact = signal<DomainContact | null>(null);
  protected readonly contactAck = signal(false);
  protected readonly contactError = signal<string | null>(null);
  protected readonly nsText = signal('');
  protected readonly nsError = signal<string | null>(null);
  protected readonly nsDefaults = signal<string[]>([]);
  protected readonly ordering = signal<string | null>(null);
  protected readonly cancelFor = signal<CustomerDomain | null>(null);
  protected readonly years = signal(1);
  protected readonly quote = signal<DomainQuote | null>(null);
  protected readonly quoting = signal(false);
  protected readonly xferDomain = signal('');
  protected readonly xferCode = signal('');
  protected readonly xferChecking = signal(false);
  protected readonly xferError = signal<string | null>(null);
  protected readonly xferQuote = signal<TransferQuote | null>(null);
  protected readonly renewing = signal<CustomerDomain | null>(null);
  protected readonly renewYears = signal(1);
  protected readonly renewQuote = signal<RenewalQuote | null>(null);
  protected readonly renewQuoting = signal(false);
  protected readonly cancelRenewalFor = signal<CustomerDomain | null>(null);
  protected readonly outFor = signal<CustomerDomain | null>(null);
  protected readonly withdrawFor = signal<CustomerDomain | null>(null);
  protected readonly codeFor = signal<{ d: CustomerDomain; code: string } | null>(null);
  protected readonly copied = signal(false);
  private latestRenewQuote = 0;
  /** Answers can arrive out of order; only the newest is shown. */
  private latestSearch = 0;
  private latestQuote = 0;

  constructor() {
    effect(() => {
      const wanted = this.register()?.trim();
      if (wanted) untracked(() => void this.fromLink(wanted));
    });
  }

  ngOnInit() {
    return this.load();
  }

  protected stage(d: CustomerDomain) {
    return DOMAIN_STAGE[d.stage];
  }

  protected badge(d: DomainResult) {
    if (d.status === 'AVAILABLE') return { label: 'Available', cls: 'cf-badge-success' };
    if (d.status === 'TAKEN') return { label: 'Taken', cls: 'cf-badge-neutral' };
    return { label: 'Could not check', cls: 'cf-badge-warning' };
  }

  private async load() {
    try {
      this.domains.set((await this.api.list()).data);
      if (!this.nsDefaults().length) this.api.nameserverDefaults().then((r) => this.nsDefaults.set(r.nameservers)).catch(() => undefined);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected async search(q: string) {
    const text = q.trim();
    if (!text) return;
    const mine = ++this.latestSearch;
    this.error.set(null);
    this.searching.set(true);
    try {
      const r = await this.api.search(text);
      if (mine === this.latestSearch) this.result.set(r);
      return r;
    } catch (e) {
      if (mine === this.latestSearch) this.error.set(toApiError(e).message);
      return undefined;
    } finally {
      if (mine === this.latestSearch) this.searching.set(false);
    }
  }

  /** Arrived from the public site's Register button: show the name, and if it is free go straight to ordering it. */
  private async fromLink(name: string) {
    this.term.set(name);
    const r = await this.search(name);
    const exact = r?.results.find((x) => x.exact && x.status === 'AVAILABLE');
    if (exact && this.auth.can('services:manage')) await this.openOrder(exact.domain);
  }

  protected async openOrder(name: string) {
    this.error.set(null);
    this.years.set(1);
    this.quote.set(null);
    this.ordering.set(name);
    await this.requote(name);
  }

  protected setYears(y: number) {
    this.years.set(y);
    const name = this.ordering();
    if (name) void this.requote(name);
  }

  private async requote(name: string) {
    const mine = ++this.latestQuote;
    this.quoting.set(true);
    this.quote.set(null);
    try {
      const q = await this.api.quote(name, this.years());
      if (mine === this.latestQuote) this.quote.set(q);
    } catch (e) {
      if (mine === this.latestQuote) this.error.set(toApiError(e).message);
    } finally {
      if (mine === this.latestQuote) this.quoting.set(false);
    }
  }

  protected async placeOrder(name: string) {
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.api.order(name, this.years());
      this.ordering.set(null);
      // The invoice page is where it is paid. A person who cannot see invoices stays here and is told what is next.
      if (this.auth.can('billing:read')) {
        await this.router.navigate([this.auth.link('/invoices'), r.invoice.id]);
        return;
      }
      this.notice.set(`Invoice ${r.invoice.number} was created for ${name}. Ask an owner or admin to pay it.`);
      await this.load();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async checkTransfer() {
    const domain = this.xferDomain().trim();
    this.xferError.set(null);
    if (!domain || !this.xferCode().trim()) {
      this.xferError.set('Enter the domain and its authorisation code.');
      return;
    }
    this.xferChecking.set(true);
    try {
      this.xferQuote.set(await this.api.transferQuote(domain));
    } catch (e) {
      this.xferError.set(toApiError(e).message);
    } finally {
      this.xferChecking.set(false);
    }
  }

  protected async placeTransfer(q: TransferQuote) {
    this.busy.set(true);
    this.xferError.set(null);
    try {
      const r = await this.api.orderTransfer(q.domain, this.xferCode().trim());
      this.xferQuote.set(null);
      this.xferCode.set('');
      this.xferDomain.set('');
      if (this.auth.can('billing:read')) {
        await this.router.navigate([this.auth.link('/invoices'), r.invoice.id]);
        return;
      }
      this.notice.set(`Invoice ${r.invoice.number} was created to transfer ${q.domain}. Ask an owner or admin to pay it.`);
      await this.load();
    } catch (e) {
      this.xferError.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async openRenew(d: CustomerDomain) {
    this.error.set(null);
    this.renewYears.set(1);
    this.renewQuote.set(null);
    this.renewing.set(d);
    await this.requoteRenewal(d);
  }

  protected setRenewYears(y: number) {
    this.renewYears.set(y);
    const d = this.renewing();
    if (d) void this.requoteRenewal(d);
  }

  private async requoteRenewal(d: CustomerDomain) {
    const mine = ++this.latestRenewQuote;
    this.renewQuoting.set(true);
    this.renewQuote.set(null);
    try {
      const q = await this.api.renewalQuote(d.id, this.renewYears());
      if (mine === this.latestRenewQuote) this.renewQuote.set(q);
    } catch (e) {
      if (mine === this.latestRenewQuote) this.error.set(toApiError(e).message);
    } finally {
      if (mine === this.latestRenewQuote) this.renewQuoting.set(false);
    }
  }

  protected async placeRenewal(d: CustomerDomain) {
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.api.renew(d.id, this.renewYears());
      this.renewing.set(null);
      if (this.auth.can('billing:read')) {
        await this.router.navigate([this.auth.link('/invoices'), r.invoice.id]);
        return;
      }
      this.notice.set(`Invoice ${r.invoice.number} was created to renew ${d.name}. Ask an owner or admin to pay it.`);
      await this.load();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async cancelRenewal(d: CustomerDomain) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.cancelRenewal(d.renewal!.id);
      this.cancelRenewalFor.set(null);
      this.notice.set(`The renewal for ${d.name} was cancelled.`);
      await this.load();
    } catch (e) {
      this.cancelRenewalFor.set(null);
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async transferOut(d: CustomerDomain) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.transferOut(d.id);
      this.outFor.set(null);
      this.notice.set(`We are unlocking ${d.name} and getting its transfer code. We will email you when it is ready.`);
      await this.load();
    } catch (e) {
      this.outFor.set(null);
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async showCode(d: CustomerDomain) {
    this.busy.set(true);
    this.error.set(null);
    this.copied.set(false);
    try {
      this.codeFor.set({ d, code: (await this.api.transferOutCode(d.id)).authCode });
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      this.copied.set(true);
    } catch {
      // Copying is a convenience; the code can be selected on screen.
    }
  }

  protected async openContacts(d: CustomerDomain) {
    this.contactError.set(null);
    this.contactAck.set(false);
    this.contact.set(null);
    this.contactFor.set(d);
    try {
      this.contact.set({ ...(await this.api.contacts(d.id)).contact });
    } catch (e) {
      this.contactError.set(toApiError(e).message);
    }
  }

  protected setContact(field: keyof DomainContact, value: string) {
    const c = this.contact();
    if (c) this.contact.set({ ...c, [field]: value });
  }

  protected async saveContacts(d: CustomerDomain) {
    const c = this.contact();
    if (!c) return;
    const missing = (['firstName', 'lastName', 'email', 'phone', 'address1', 'city', 'state', 'postalCode', 'country'] as const).find((f) => !String(c[f] ?? '').trim());
    if (missing) {
      this.contactError.set('Fill in every field that is not marked optional.');
      return;
    }
    if (!this.contactAck()) {
      this.contactError.set('Tick the box to confirm you have read the warning.');
      return;
    }
    this.busy.set(true);
    this.contactError.set(null);
    try {
      await this.api.changeContacts(d.id, c);
      this.contactFor.set(null);
      this.notice.set(`We are changing the contact details of ${d.name}. We will email you when it is done.`);
      await this.load();
    } catch (e) {
      this.contactError.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async withdrawContacts(d: CustomerDomain) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.cancelContacts(d.id);
      this.notice.set(`The contact change for ${d.name} was withdrawn.`);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
      await this.load();
    }
  }

  protected openNameservers(d: CustomerDomain) {
    this.nsError.set(null);
    this.nsText.set((d.nameservers ?? []).join('\n'));
    this.nsFor.set(d);
  }

  protected async saveNameservers(d: CustomerDomain) {
    const list = this.nsText().split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (list.length < 2) {
      this.nsError.set('Enter at least two nameservers, one per line.');
      return;
    }
    this.busy.set(true);
    this.nsError.set(null);
    try {
      await this.api.changeNameservers(d.id, list);
      this.nsFor.set(null);
      this.notice.set(`We are changing the nameservers of ${d.name}. We will email you when it is done.`);
      await this.load();
    } catch (e) {
      this.nsError.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async withdrawNameservers(d: CustomerDomain) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.cancelNameservers(d.id);
      this.notice.set(`The nameserver change for ${d.name} was withdrawn.`);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
      await this.load();
    }
  }

  protected async withdraw(d: CustomerDomain) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.cancelTransferOut(d.id);
      this.withdrawFor.set(null);
      this.notice.set(`The transfer of ${d.name} was withdrawn. It stays with us.`);
      await this.load();
    } catch (e) {
      this.withdrawFor.set(null);
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async cancel(d: CustomerDomain) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.cancel(d.id);
      this.cancelFor.set(null);
      this.notice.set(`The order for ${d.name} was cancelled.`);
      await this.load();
    } catch (e) {
      this.cancelFor.set(null);
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}
