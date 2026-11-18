import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Art } from '../../../design-system/art/art';
import { WHY_ITEMS } from '../content/why.content';
import { CtaBand } from '../shared/cta-band';
import { PageHero } from '../shared/page-hero';
import { ProcessSection } from '../shared/process-section';
import { Reveal } from '../shared/reveal';
import { SectionHead } from '../shared/section-head';

@Component({
  selector: 'ci-about',
  imports: [RouterLink, Art, Reveal, PageHero, SectionHead, ProcessSection, CtaBand],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ci-page-hero
      [crumbs]="[{ label: 'About Us' }]"
      overline="About Ciril Info"
      title="Your Digital"
      highlight="Growth Partner"
      lead="Ciril Info is a digital solutions agency. We help businesses establish, grow and strengthen their online presence with creative website design, powerful development, digital marketing, online promotions and reliable domain services."
    >
      <div actions class="cx-cta-row">
        <a routerLink="/contact" class="cf-btn cf-btn-primary cf-btn-lg">Talk to Us</a>
        <a routerLink="/services" class="cf-btn cf-btn-secondary cf-btn-lg">Our Services</a>
      </div>
    </ci-page-hero>

    <section class="cx-section" aria-labelledby="ov-h">
      <div class="cx-container">
        <ci-section-head
          overline="Company overview"
          title="We design, develop, promote, and"
          highlight="power your digital presence"
          lead="Most businesses need more than a website. They need a partner who can connect design, technology, marketing and the basics, like a domain, into one coherent presence."
          headingId="ov-h"
        />
        <div class="cx-story">
          @for (s of story; track s.word) {
            <div ciReveal class="cx-story-row">
              <h3 class="cx-story-word">{{ s.word }}</h3>
              <p>{{ s.text }}</p>
            </div>
          }
        </div>
      </div>
    </section>

    <section class="cx-section cx-section--subtle" aria-label="Mission and vision">
      <div class="cx-container cx-mv">
        <div ciReveal class="cx-mv-card cx-mv-card--brand">
          <span class="cx-overline">Our mission</span>
          <p>To help businesses establish, grow and strengthen their digital presence through creative design, dependable technology and honest, results-minded marketing.</p>
        </div>
        <div ciReveal class="cx-mv-card cx-mv-card--soft">
          <span class="cx-overline">Our vision</span>
          <p>To be the digital growth partner that businesses trust to build, promote and power everything they do online.</p>
        </div>
      </div>
    </section>

    <section class="cx-section" aria-labelledby="val-h">
      <div class="cx-container">
        <ci-section-head
          overline="Values"
          title="What We"
          highlight="Stand For"
          lead="The principles behind how we work with clients and with each other."
          headingId="val-h"
        />
        <div class="cx-grid cx-cards-3">
          @for (v of values; track v.title; let i = $index) {
            <div ciReveal>
              <article class="cf-card cx-card">
                <span class="cf-tile"><ci-art set="aboutValues" [index]="i" /></span>
                <h3>{{ v.title }}</h3>
                <p>{{ v.text }}</p>
              </article>
            </div>
          }
        </div>
      </div>
    </section>

    <ci-process-section tone="subtle" />

    <section class="cx-section" aria-labelledby="why-h">
      <div class="cx-container cx-why">
        <div ciReveal class="cx-why-intro">
          <span class="cx-overline">Why Ciril Info</span>
          <h2 class="cx-h2" id="why-h">Why Businesses Choose <span class="cx-hl">Ciril Info</span></h2>
          <p class="cx-lead">More than a web design company: a complete digital partner for businesses that want to build, establish, promote and grow online.</p>
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

    <section class="cx-section cx-section--subtle" aria-labelledby="com-h">
      <div class="cx-container cx-split">
        <div ciReveal>
          <span class="cx-overline">Our commitment to clients</span>
          <h2 class="cx-h2" id="com-h">A Partnership, <span class="cx-hl">Not Just a Project</span></h2>
          <p class="cx-lead">We measure our work by whether it genuinely helps your business, and we build relationships that last beyond launch day.</p>
          <a routerLink="/contact" class="cf-btn cf-btn-primary cf-btn-lg">Start a Conversation</a>
        </div>
        <ul class="cx-commit">
          @for (c of commitments; track c.title; let i = $index) {
            <li ciReveal>
              <span class="cf-tile"><ci-art set="aboutCommit" [index]="i" /></span>
              <div>
                <h3>{{ c.title }}</h3>
                <p>{{ c.text }}</p>
              </div>
            </li>
          }
        </ul>
      </div>
    </section>

    <ci-cta-band />
  `,
})
export class About {
  protected readonly why = WHY_ITEMS;

  protected readonly story = [
    { word: 'Design', text: 'Interfaces and identities that are clear, memorable and shaped around your customers.' },
    { word: 'Develop', text: 'Fast, maintainable websites and stores built on modern, dependable technology.' },
    { word: 'Promote', text: 'Marketing and campaigns that carry your message to the people who need to hear it.' },
    { word: 'Power', text: 'Domains, hosting-ready setup and ongoing support that keep your presence running.' },
  ];

  protected readonly values = [
    { title: 'Creativity with purpose', text: 'Ideas that serve your goals, not decoration for its own sake.' },
    { title: 'Integrity', text: 'Honest advice, honest timelines and no inflated promises.' },
    { title: 'Clarity', text: 'Plain language, clear scope and visible progress at every step.' },
    { title: 'Quality', text: 'Careful craft in design, code and content before anything ships.' },
    { title: 'Partnership', text: 'We work alongside you and treat your goals as our own.' },
    { title: 'Care', text: 'We care about your customers’ experience as much as you do.' },
  ];

  protected readonly commitments = [
    { title: 'You stay informed', text: 'Regular updates and a clear point of contact throughout your project.' },
    { title: 'Your goals lead', text: 'Recommendations are based on what your business needs, not on what is easiest for us.' },
    { title: 'Straight answers', text: 'We tell you what we can and cannot do, including where results depend on factors outside our control.' },
    { title: 'Support after launch', text: 'Launch is a milestone, not the end of the relationship.' },
  ];
}
