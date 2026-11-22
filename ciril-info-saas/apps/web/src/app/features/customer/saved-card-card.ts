import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Dialog } from '../../design-system/dialogs/dialog';
import { Icon } from '../../design-system/icon/icon';
import { BillingApi, type SavedCardView, money } from './billing.api';

/**
 * The organisation's saved card on the Invoices page: which card it is, whether renewals are charged to it
 * automatically, and a way to remove it. Hidden entirely when cards cannot be saved.
 */
@Component({
  selector: 'ci-saved-card',
  imports: [Dialog, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; margin-bottom: var(--space-5); }
    .card { border: 1px solid var(--color-border-subtle); max-width: 720px; }
    .row { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; justify-content: space-between; }
    .what { display: flex; gap: var(--space-3); align-items: center; }
    .actions { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; margin-top: var(--space-3); }
    p { margin: var(--space-2) 0 0; }
  `,
  template: `
    @if (view(); as v) {
      @if (v.available) {
        <section class="cf-card card" aria-labelledby="card-h">
          <h2 id="card-h" class="ts-heading-5">Automatic payments</h2>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          @if (notice(); as n) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ n }}</span></div> }
          @if (v.card; as c) {
            <div class="row">
              <div class="what">
                <ci-icon name="card" />
                <span data-testid="saved-card"><strong>{{ c.network ?? 'Card' }} ending {{ c.last4 ?? '····' }}</strong>@if (c.expiryMonth && c.expiryYear) { · expires {{ pad(c.expiryMonth) }}/{{ c.expiryYear }} }</span>
              </div>
              <span class="cf-badge" [class]="'cf-badge ' + badge(v).cls">{{ badge(v).label }}</span>
            </div>
            @if (c.status === 'PENDING') {
              <p class="cf-help">Your bank is still confirming the card for automatic payments. This usually takes a few minutes.</p>
            } @else if (c.autoPay) {
              <p class="cf-help">Renewal invoices up to {{ fmt(c.maxAmount) }} are charged to this card a day before they are due. We email you the amount and the date first.</p>
            } @else {
              <p class="cf-help">Automatic payments are off. Renewal invoices wait for you to pay them.</p>
            }
            @if (auth.can('billing:pay')) {
              <div class="actions">
                <label class="cf-check"><input type="checkbox" [checked]="c.autoPay" [disabled]="busy()" (change)="setAutoPay($any($event.target).checked)" /><span>Pay renewal invoices automatically</span></label>
                <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="confirming.set(true)">Remove card</button>
              </div>
            }
          } @else {
            <p class="cf-help" data-testid="no-saved-card">No card is saved. When you next pay an invoice by card, tick “Save this card” and your renewals will be paid automatically.</p>
          }
        </section>
      }
    }

    @if (confirming()) {
      <ci-dialog heading="Remove this card?" description="It is deleted from our payment provider, and renewal invoices will wait for you to pay them. You can save a card again when you next pay." icon="warning" tone="danger" [dismissable]="false" (closed)="confirming.set(false)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="confirming.set(false)">Keep it</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy()" (click)="remove()">{{ busy() ? 'Removing…' : 'Remove card' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class SavedCardCard implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(BillingApi);
  protected readonly view = signal<SavedCardView | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirming = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly fmt = (v: string) => money(v);

  ngOnInit() {
    void this.load();
  }

  protected pad(n: number) {
    return String(n).padStart(2, '0');
  }

  protected badge(v: SavedCardView) {
    const c = v.card!;
    if (c.status === 'PENDING') return { cls: 'cf-badge-warning', label: 'Waiting for your bank' };
    return c.autoPay ? { cls: 'cf-badge-success', label: 'Automatic payments on' } : { cls: 'cf-badge-neutral', label: 'Automatic payments off' };
  }

  private async load() {
    try {
      this.view.set(await this.api.savedCard());
    } catch {
      // The rest of the page works without this panel.
    }
  }

  protected async setAutoPay(on: boolean) {
    await this.act(async () => {
      this.view.set(await this.api.setAutoPay(on));
      this.notice.set(on ? 'Renewal invoices will be charged to this card automatically.' : 'Automatic payments are off. Renewal invoices will wait for you to pay them.');
    });
  }

  protected async remove() {
    await this.act(async () => {
      this.view.set(await this.api.removeSavedCard());
      this.confirming.set(false);
      this.notice.set('The card was removed. Renewal invoices will wait for you to pay them.');
    });
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await fn();
    } catch (e) {
      this.confirming.set(false);
      this.error.set(toApiError(e).message);
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }
}
