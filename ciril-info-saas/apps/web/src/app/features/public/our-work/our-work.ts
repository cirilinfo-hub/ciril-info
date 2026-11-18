import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../design-system/icon/icon';
import { CtaBand } from '../shared/cta-band';
import { PageHero } from '../shared/page-hero';
import { ProjectCard } from '../shared/project-card';
import { ProjectDialog } from '../shared/project-dialog';
import { PublicApi, type PublicProject } from '../shared/public-api';
import { TestimonialsSection } from '../shared/testimonials-section';

/** Portfolio (design: Our Work). Projects come from the admin-managed list. */
@Component({
  selector: 'ci-our-work',
  imports: [RouterLink, Icon, PageHero, ProjectCard, ProjectDialog, TestimonialsSection, CtaBand],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ci-page-hero
      [crumbs]="[{ label: 'Our Work' }]"
      overline="Our work"
      title="Projects That Show"
      highlight="How We Work"
      [lead]="lead()"
    />

    <section class="cx-section">
      <div class="cx-container">
        @if (loaded()) {
          @if (allSample()) {
            <div class="cf-alert cf-alert-info" role="note">
              <ci-icon name="info" />
              <div>
                <strong>These are demonstration projects</strong>
                <span>Every project on this page is a fictional concept created to illustrate our approach. They are not client work and no results are claimed. Real projects will replace them as clients give permission.</span>
              </div>
            </div>
          }

          @if (projects().length) {
            @if (categories().length > 1) {
              <div class="cx-filter">
                <div class="cf-seg" role="group" aria-label="Filter projects by category">
                  <button type="button" [attr.aria-pressed]="filter() === 'All'" (click)="filter.set('All')">All</button>
                  @for (c of categories(); track c) {
                    <button type="button" [attr.aria-pressed]="filter() === c" (click)="filter.set(c)">{{ c }}</button>
                  }
                </div>
              </div>
            }
            <p class="cx-sr" aria-live="polite">{{ shown().length }} {{ allSample() ? 'sample ' : '' }}{{ shown().length === 1 ? 'project' : 'projects' }} shown</p>
            <div class="cx-work-grid">
              @for (p of shown(); track p.slug) { <ci-project-card [project]="p" (details)="open.set($event)" /> }
            </div>
          } @else {
            <div class="cf-alert cf-alert-info" role="note">
              <ci-icon name="info" />
              <div>
                <strong>Projects are on their way</strong>
                <span>We are preparing case studies to share here. In the meantime, tell us about your project and we will walk you through how we work.</span>
              </div>
            </div>
            <p><a routerLink="/contact" class="cf-btn cf-btn-primary cf-btn-lg">Start Your Project</a></p>
          }
        } @else {
          <div class="ci-skeleton" style="height: 320px" aria-hidden="true"></div>
        }
      </div>
    </section>
    @if (open(); as p) { <ci-project-dialog [project]="p" (closed)="open.set(null)" /> }

    <ci-testimonials-section placement="work" />
    <ci-cta-band />
  `,
})
export class OurWork {
  private readonly api = inject(PublicApi);
  private readonly result = toSignal(this.api.projects());

  protected readonly loaded = computed(() => this.result() !== undefined);
  protected readonly projects = computed(() => this.result() ?? []);
  protected readonly allSample = computed(() => this.projects().length > 0 && this.projects().every((p) => p.isSample));
  protected readonly categories = computed(() => [...new Set(this.projects().map((p) => p.category))]);
  protected readonly filter = signal('All');
  protected readonly open = signal<PublicProject | null>(null);
  protected readonly shown = computed(() => {
    const f = this.filter();
    return f === 'All' ? this.projects() : this.projects().filter((p) => p.category === f);
  });
  protected readonly lead = computed(() =>
    this.allSample()
      ? 'Browse sample projects across web design, development, marketing and promotions. Select a project to see its scope and the technology behind it.'
      : 'Browse our projects across web design, development, marketing and promotions. Select a project to see its scope and the technology behind it.',
  );
}
