import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../../../core/api/api-error';
import { Field, describedBy } from '../../../design-system/forms/field';
import { applyServerErrors, clearServerErrors } from '../../../design-system/forms/server-errors';
import { Art } from '../../../design-system/art/art';
import { Icon } from '../../../design-system/icon/icon';
import { SERVICES } from '../content/services.content';
import { FaqSection } from '../shared/faq-section';
import { PageHero } from '../shared/page-hero';
import { PublicApi } from '../shared/public-api';
import { Reveal } from '../shared/reveal';

/** Services offered in the enquiry form. The API validates against the same list. */
export const INQUIRY_SERVICES = [
  ...SERVICES.map((s) => s.name),
  'More than one service',
  'Business or partnership enquiry',
  'Not sure yet',
];
const BUDGETS = ['Not decided yet', 'Small project', 'Mid-size project', 'Large project', 'Ongoing monthly support', 'Prefer to discuss'];

@Component({
  selector: 'ci-contact',
  imports: [ReactiveFormsModule, RouterLink, Field, Icon, Art, Reveal, PageHero, FaqSection],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
    .done { display: grid; gap: var(--space-4); }
  `,
  template: `
    <ci-page-hero
      [crumbs]="[{ label: 'Contact' }]"
      overline="Contact us"
      title="Let’s Build Something"
      highlight="Great Together"
      lead="Tell us about your business and what you want to achieve. We will review your enquiry and suggest the right next steps."
    />

    <section class="cx-section" aria-label="Contact form and details">
      <div class="cx-container cx-contact">
        <div ciReveal class="cx-formcard">
          @if (!sent()) {
            <h2 class="cx-h3">Request a quote</h2>
            <p class="cx-body">Fields marked * are required.</p>
            @if (error(); as e) {
              <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div>
            }
            <form class="cx-form" [formGroup]="form" (ngSubmit)="submit()" (input)="clear()" novalidate aria-label="Contact form">
              <ci-field label="Name" [required]="true" for="c-name" [control]="form.controls.name">
                <input id="c-name" class="cf-input" autocomplete="name" placeholder="Your full name" formControlName="name" [attr.aria-describedby]="describedBy('c-name', form.controls.name)" [attr.aria-required]="true" />
              </ci-field>
              <ci-field label="Email" [required]="true" for="c-email" [control]="form.controls.email">
                <input id="c-email" class="cf-input" type="email" autocomplete="email" placeholder="name@company.com" formControlName="email" [attr.aria-describedby]="describedBy('c-email', form.controls.email)" [attr.aria-required]="true" />
              </ci-field>
              <ci-field label="Phone" for="c-phone" [control]="form.controls.phone">
                <input id="c-phone" class="cf-input" type="tel" autocomplete="tel" placeholder="Optional" formControlName="phone" [attr.aria-describedby]="describedBy('c-phone', form.controls.phone)" />
              </ci-field>
              <ci-field label="Company" for="c-company" [control]="form.controls.company">
                <input id="c-company" class="cf-input" autocomplete="organization" placeholder="Optional" formControlName="company" />
              </ci-field>
              <ci-field label="Service required" errorLabel="a service" [required]="true" for="c-service" [control]="form.controls.service">
                <select id="c-service" class="cf-input" formControlName="service" [attr.aria-describedby]="describedBy('c-service', form.controls.service)" [attr.aria-required]="true">
                  <option value="">Select a service</option>
                  @for (s of services; track s) { <option [value]="s">{{ s }}</option> }
                </select>
              </ci-field>
              <ci-field label="Project budget" for="c-budget" [control]="form.controls.budget">
                <select id="c-budget" class="cf-input" formControlName="budget">
                  <option value="">Select a range (optional)</option>
                  @for (b of budgets; track b) { <option [value]="b">{{ b }}</option> }
                </select>
              </ci-field>
              <div class="span-2">
                <ci-field label="Project description" [required]="true" for="c-message" [control]="form.controls.message">
                  <textarea id="c-message" class="cf-input" rows="5" maxlength="1000" placeholder="What would you like to achieve? Share goals, timing and anything we should know." formControlName="message" [attr.aria-describedby]="describedBy('c-message', form.controls.message)" [attr.aria-required]="true"></textarea>
                  <span class="cf-count">{{ form.controls.message.value.length }} / 1000 characters</span>
                </ci-field>
              </div>
              <!-- Honeypot: hidden from people and assistive tech; bots fill it and are ignored. -->
              <div class="hp" aria-hidden="true">
                <label for="c-website">Leave this field empty</label>
                <input id="c-website" tabindex="-1" autocomplete="off" formControlName="website" />
              </div>
              <div class="span-2">
                <label class="cf-check">
                  <input type="checkbox" formControlName="consent" [attr.aria-describedby]="form.controls.consent.touched && form.controls.consent.invalid ? 'c-consent-err' : null" />
                  <span>I agree that Ciril Info may contact me about this enquiry. *</span>
                </label>
                @if (form.controls.consent.touched && form.controls.consent.invalid) {
                  <span id="c-consent-err" class="cf-help cf-help-error" role="alert">Please agree to be contacted so we can reply.</span>
                }
              </div>
              <div class="span-2 cx-form-actions">
                <button type="submit" class="cf-btn cf-btn-accent cf-btn-lg" [disabled]="busy()">
                  {{ busy() ? 'Sending…' : 'Send Enquiry' }} <ci-icon name="arrow-right" [size]="16" />
                </button>
                <p class="cx-note">Read our <a routerLink="/privacy-policy">Privacy Policy</a>.</p>
              </div>
            </form>
          } @else {
            <div class="done" role="status">
              <h2 class="cx-h3">Thank you, we have your enquiry</h2>
              <p class="cx-body">We will review your details and reply to {{ form.controls.email.value }} with the right next steps.</p>
              <div><a routerLink="/" class="cf-btn cf-btn-secondary">Back to Home</a></div>
            </div>
          }
        </div>

        <aside class="cx-aside" aria-label="Contact details">
          <div ciReveal>
            <ul class="cx-info">
              <li>
                <span class="cf-tile"><ci-art set="contact" [index]="0" /></span>
                <div><b>Email</b>@if (company()?.email; as v) { <a [href]="'mailto:' + v">{{ v }}</a> } @else { <span class="pending">Email address to be added</span> }</div>
              </li>
              <li>
                <span class="cf-tile"><ci-art set="contact" [index]="1" /></span>
                <div><b>Phone</b>@if (company()?.phone; as v) { <a [href]="'tel:' + v.replace(' ', '')">{{ v }}</a> } @else { <span class="pending">Phone number to be added</span> }</div>
              </li>
              <li>
                <span class="cf-tile"><ci-art set="contact" [index]="2" /></span>
                <div><b>Address</b>@if (company()?.address; as v) { <span>{{ v }}</span> } @else { <span class="pending">Business address to be added</span> }</div>
              </li>
              <li>
                <span class="cf-tile"><ci-art set="contact" [index]="3" /></span>
                <div><b>Business hours</b>@if (company()?.hours; as v) { <span>{{ v }}</span> } @else { <span class="pending">Hours to be added</span> }</div>
              </li>
            </ul>
          </div>
          <div ciReveal class="cx-wa">
            <span class="cf-tile"><ci-art set="whatsapp" [index]="0" /></span>
            <h3>Prefer WhatsApp?</h3>
            <p>Send us a quick message and we will pick it up from there.</p>
            @if (whatsappLink(); as href) {
              <a class="cf-btn cf-btn-primary" [href]="href" target="_blank" rel="noopener">Chat on WhatsApp</a>
            } @else {
              <button class="cf-btn cf-btn-primary" type="button" disabled>Chat on WhatsApp</button>
              <p class="cx-note">WhatsApp number to be added.</p>
            }
          </div>
          <div ciReveal class="cx-biz">
            <span class="cx-overline">Business enquiries</span>
            <h3>Partnerships, agencies and larger projects</h3>
            <p>Working on a multi-service project or looking for a long-term digital partner? Choose “Business or partnership enquiry” in the form.</p>
          </div>
        </aside>
      </div>
    </section>

    <ci-faq-section topic="contact" title="Before You" highlight="Reach Out" [subtle]="true" />
  `,
})
export class Contact {
  private readonly api = inject(PublicApi);
  protected readonly describedBy = describedBy;
  protected readonly services = INQUIRY_SERVICES;
  protected readonly budgets = BUDGETS;

  /** `?service=web-design` pre-selects that service (set by "Request a quote" links). */
  readonly service = input<string>();

  /** `?domain=acme.com` (from a domain search result) pre-fills the message with a registration request. */
  readonly domain = input<string>();

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    phone: ['', [Validators.pattern(/^\+?[0-9 ()-]{6,24}$/)]],
    company: ['', [Validators.maxLength(160)]],
    service: ['', [Validators.required]],
    budget: [''],
    message: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(1000)]],
    consent: [false, [Validators.requiredTrue]],
    website: [''],
  });

  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly site = toSignal(this.api.site());
  protected readonly company = computed(() => this.site()?.company ?? null);
  protected readonly whatsappLink = computed(() => {
    const digits = this.company()?.whatsapp?.replace(/\D/g, '');
    return digits && digits.length >= 8 ? `https://wa.me/${digits}` : null;
  });

  constructor() {
    // Pre-select the service passed in the link (slug or exact name).
    effect(() => {
      const s = this.service();
      const match = SERVICES.find((x) => x.slug === s)?.name ?? INQUIRY_SERVICES.find((x) => x === s);
      if (match) untracked(() => this.form.controls.service.setValue(match));
    });
    effect(() => {
      const d = this.domain()?.toLowerCase();
      if (d && /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(d)) {
        untracked(() => {
          if (!this.form.controls.message.value) this.form.controls.message.setValue(`I would like to register ${d}.`);
        });
      }
    });
  }

  clear() {
    clearServerErrors(this.form);
  }

  async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    try {
      await firstValueFrom(
        this.api.submitInquiry({
          name: v.name,
          email: v.email,
          phone: v.phone || undefined,
          company: v.company || undefined,
          service: v.service,
          budget: v.budget || undefined,
          message: v.message,
          consent: v.consent,
          website: v.website || undefined,
        }),
      );
      this.sent.set(true);
    } catch (e) {
      const err = toApiError(e);
      this.error.set(
        err.status === 429
          ? 'You have sent several enquiries in a short time. Please wait a few minutes and try again.'
          : applyServerErrors(this.form, err),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
