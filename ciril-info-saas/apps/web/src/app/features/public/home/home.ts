import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { Art } from '../../../design-system/art/art';
import { Icon } from '../../../design-system/icon/icon';
import { PROCESS_STEPS, SERVICES } from '../content/services.content';
import { CtaBand } from '../shared/cta-band';
import { FaqSection } from '../shared/faq-section';
import { ProcessSection } from '../shared/process-section';
import { ProjectCard } from '../shared/project-card';
import { ProjectDialog } from '../shared/project-dialog';
import { PublicApi, type PublicProject } from '../shared/public-api';
import { Reveal } from '../shared/reveal';
import { SectionHead } from '../shared/section-head';
import { TestimonialsSection } from '../shared/testimonials-section';
import { WHY_ITEMS } from '../content/why.content';
import { HeroArt } from './hero-art';

@Component({
  selector: 'ci-home',
  imports: [
    AsyncPipe, RouterLink, Icon, Art, Reveal, HeroArt, SectionHead, ProcessSection, ProjectCard, ProjectDialog,
    TestimonialsSection, FaqSection, CtaBand,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cx-hero" aria-labelledby="hero-h">
      <div class="cx-container cx-container--xl cx-hero-grid">
        <div class="cx-hero-top">
          <span class="cx-overline">Digital Solutions Agency</span>
          <!-- Explicit {{ ' ' }} separators: Angular strips newline-only whitespace between
               elements, which would join the lines into one unbreakable word on mobile. -->
          <h1 class="cx-hero-h" id="hero-h">
            <span class="ln" style="--i: 0">Build Your Digital Presence.</span>{{ ' ' }}
            <span class="ln cx-hl" style="--i: 1">Accelerate</span>{{ ' ' }}
            <span class="ln cx-hl" style="--i: 2">Your Growth.</span>
          </h1>
        </div>
        <div class="cx-hero-copy">
          <p class="cx-lead">
            From stunning websites to powerful digital marketing strategies, Ciril Info helps your business stand out,
            connect with customers, and grow online.
          </p>
          <div class="cx-cta-row">
            <a routerLink="/contact" class="cf-btn cf-btn-accent cf-btn-lg">Let’s Get Started <ci-icon name="arrow-right" [size]="16" /></a>
            <a routerLink="/services" class="cf-btn cf-btn-secondary cf-btn-lg">Explore Our Services</a>
          </div>
          <ul class="cx-hero-points">
            @for (p of points; track p) {
              <li><ci-icon name="check-circle" [size]="16" />{{ p }}</li>
            }
          </ul>
        </div>
        <div ciHeroArt></div>
      </div>
    </section>

    <div class="cx-marquee" role="region" aria-label="Our services">
      <div class="cx-marquee-track">
        @for (g of [0, 1]; track g) {
          <div class="cx-marquee-group" [attr.aria-hidden]="g === 1 ? 'true' : null">
            @for (s of services; track s.slug) {
              <span class="cx-marquee-item">{{ s.name }}<i></i></span>
            }
          </div>
        }
      </div>
    </div>

    <section class="cx-section cx-section--subtle" aria-labelledby="value-h">
      <div class="cx-container">
        <ci-section-head
          overline="Why it matters"
          title="Everything Your Business Needs to"
          highlight="Grow Online"
          lead="One team for the full journey, from the first idea to a presence that keeps growing."
          headingId="value-h"
        />
        <div class="cx-cols">
          @for (v of values; track v.title; let i = $index) {
            <div ciReveal class="cx-col">
              <div class="cx-col-top"><span class="cx-col-n">{{ '0' + (i + 1) }}</span><ci-art set="value" [index]="i" /></div>
              <h3>{{ v.title }}</h3>
              <p>{{ v.text }}</p>
            </div>
          }
        </div>
        <div ciReveal class="cx-stats-wrap">
          <div class="cf-stats">
            @if (claimStats$ | async; as stats) {
              @for (s of stats.length ? stats : facts; track s.label) {
                <div class="cf-stat"><strong>{{ s.value }}</strong><span>{{ s.label }}</span></div>
              }
            }
          </div>
        </div>
      </div>
    </section>

    <section class="cx-section" aria-labelledby="svc-h" id="services">
      <div class="cx-container">
        <ci-section-head
          overline="What we do"
          title="Complete Digital Solutions"
          highlight="Under One Roof"
          lead="Five connected services that take your business from first idea to a growing online presence."
          headingId="svc-h"
        />
        <ol class="cx-index">
          @for (s of services; track s.slug; let i = $index) {
            <li ciReveal class="cx-index-row">
              <span class="cx-index-num">{{ '0' + (i + 1) }}</span>
              <div class="cx-index-art"><ci-art set="svcArt" [index]="i" /></div>
              <div class="cx-index-main">
                <h3><ci-art set="svcIcon" [index]="i" />{{ s.name }}</h3>
                <p>{{ s.tagline }}</p>
                <a class="cx-index-cta" [routerLink]="['/services', s.slug]">{{ s.exploreLabel }}<ci-icon name="arrow-right" [size]="16" /></a>
              </div>
              <ul class="cx-feat cx-index-feat" [attr.aria-label]="s.name + ' features'">
                @for (f of s.features; track f.title) { <li><ci-icon name="check" [size]="16" />{{ f.title }}</li> }
              </ul>
              <span class="cx-index-go" aria-hidden="true"><ci-icon name="arrow-right" /></span>
            </li>
          }
        </ol>
      </div>
    </section>

    <section class="cx-section cx-section--subtle" aria-labelledby="why-h">
      <div class="cx-container cx-why">
        <div ciReveal class="cx-why-intro">
          <span class="cx-overline">Why Ciril Info</span>
          <h2 class="cx-h2" id="why-h">Why Businesses Choose <span class="cx-hl">Ciril Info</span></h2>
          <p class="cx-lead">More than a web design company: a complete digital partner for businesses that want to build, establish, promote and grow online.</p>
          <div><a routerLink="/about" class="cf-btn cf-btn-secondary">About Ciril Info <ci-icon name="arrow-right" [size]="16" /></a></div>
        </div>
        <div class="cx-why-list">
          @for (w of why; track w.title; let i = $index) {
            <div ciReveal class="cx-why-item">
              <span class="cf-tile"><ci-art set="why" [index]="i" /></span>
              <h3>{{ w.title }}</h3>
              <p>{{ w.text }}</p>
            </div>
          }
        </div>
      </div>
    </section>

    <ci-process-section tone="dark" />

    @if (projects$ | async; as projects) {
      @if (projects.length) {
        <section class="cx-section" aria-labelledby="work-h">
          <div class="cx-container">
            <ci-section-head
              overline="Our work"
              title="A Look at How We"
              highlight="Approach Projects"
              [lead]="sampleNote(projects)"
              headingId="work-h"
            />
            <div class="cx-work-grid">
              @for (p of projects; track p.slug) { <ci-project-card [project]="p" (details)="open.set($event)" /> }
            </div>
            <div ciReveal><a routerLink="/our-work" class="cf-btn cf-btn-primary cf-btn-lg">{{ projects[0]?.isSample ? 'View All Sample Work' : 'View All Work' }}</a></div>
          </div>
        </section>
      }
    }
    @if (open(); as p) { <ci-project-dialog [project]="p" (closed)="open.set(null)" /> }

    <ci-testimonials-section placement="home" />
    <ci-faq-section topic="home" />
    <ci-cta-band />
  `,
})
export class Home {
  private readonly api = inject(PublicApi);

  protected readonly points = ['Website Design', 'Development', 'Digital Marketing', 'Promotions', 'Domains'];
  protected readonly services = SERVICES;
  protected readonly why = WHY_ITEMS;
  protected readonly open = signal<PublicProject | null>(null);

  protected readonly values = [
    { title: 'Creative Excellence', text: 'Design with a point of view, shaped around your brand and the people you want to reach.' },
    { title: 'Smart Technology', text: 'Modern, dependable tools chosen to fit your goals, not to follow trends.' },
    { title: 'Digital Growth', text: 'Websites, marketing and promotions that work together to move your business forward.' },
    { title: 'Reliable Support', text: 'A partner who stays available after launch, with clear communication along the way.' },
  ];

  /** Structural facts about this site's own offer (counted from its content, not claimed results). */
  protected readonly facts = [
    { value: String(SERVICES.length), label: 'Core digital services' },
    { value: String(PROCESS_STEPS.length), label: 'Step process, from discovery to growth' },
    { value: '1', label: 'Partner for your whole digital presence' },
  ];

  /** Real, admin-entered figures replace the structural facts once configured. */
  protected readonly claimStats$ = this.api.site().pipe(map((s) => s?.claims.stats ?? []));
  protected readonly projects$ = this.api.projects().pipe(map((p) => p.slice(0, 4)));

  protected sampleNote(projects: PublicProject[]): string {
    return projects.every((p) => p.isSample)
      ? 'These are sample projects created to demonstrate our approach. They are not client work, and real projects will replace them as they are shared.'
      : 'A selection of recent projects across design, development, marketing and promotion.';
  }
}
