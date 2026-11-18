import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { map } from 'rxjs';
import { Icon } from '../../../design-system/icon/icon';
import type { IconName } from '../../../design-system/icon/icon-paths';
import { PublicApi, type SiteClaims } from './public-api';
import { Reveal } from './reveal';
import { SectionHead } from './section-head';

interface Item {
  icon: IconName;
  title: string;
  text: string;
}

/** Only claims an admin has set (Admin → Settings → Website claims) become cards. */
export function claimItems(c: SiteClaims): Item[] {
  const items: Item[] = [];
  if (c.uptimePercent != null) items.push({ icon: 'shield', title: `${c.uptimePercent}% uptime guarantee`, text: 'Our availability commitment for hosting plans.' });
  if (c.moneyBackDays != null) items.push({ icon: 'refresh', title: `${c.moneyBackDays}-day money-back guarantee`, text: 'On eligible hosting plans. The refund policy has the details.' });
  if (c.freeMigrationSites != null) items.push({ icon: 'migrate', title: 'Free migration', text: `We move up to ${c.freeMigrationSites} ${c.freeMigrationSites === 1 ? 'site' : 'sites'} for you.` });
  if (c.dataCentres.length) items.push({ icon: 'server', title: `Data centres in ${c.dataCentres.join(', ')}`, text: 'Choose a location close to your visitors.' });
  if (c.supportHours) items.push({ icon: 'headset', title: `Support: ${c.supportHours}`, text: c.supportResponseTime ? `Typical first response: ${c.supportResponseTime}.` : 'Real people, whenever you need them.' });
  if (c.sslWarranty) items.push({ icon: 'lock', title: 'SSL certificates', text: c.sslWarranty });
  if (c.domainTransferTime) items.push({ icon: 'globe', title: 'Domain transfers', text: `Typically completed in ${c.domainTransferTime}.` });
  return items;
}

@Component({
  selector: 'ci-claims-strip',
  imports: [AsyncPipe, Icon, Reveal, SectionHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    @if (items$ | async; as items) {
      @if (items.length) {
        <section class="cx-section" aria-labelledby="claims-h">
          <div class="cx-container">
            <ci-section-head overline="Included" title="What You Can" highlight="Count On" headingId="claims-h" />
            <div class="cx-grid cx-cards-4">
              @for (i of items; track i.title) {
                <div ciReveal>
                  <article class="cf-card cx-card cx-card--static">
                    <span class="cf-tile"><ci-icon [name]="i.icon" /></span>
                    <h3>{{ i.title }}</h3>
                    <p>{{ i.text }}</p>
                  </article>
                </div>
              }
            </div>
          </div>
        </section>
      }
    }
  `,
})
export class ClaimsStrip {
  protected readonly items$ = inject(PublicApi).site().pipe(map((s) => (s ? claimItems(s.claims) : [])));
}
