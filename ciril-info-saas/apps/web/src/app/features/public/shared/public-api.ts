import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, catchError, map, of, shareReplay } from 'rxjs';
import { RUNTIME_CONFIG } from '../../../core/config/runtime-config';

export interface SiteClaims {
  uptimePercent: number | null;
  moneyBackDays: number | null;
  freeMigrationSites: number | null;
  freeMigrationPlanSlugs: string[];
  dataCentres: string[];
  supportHours: string | null;
  supportResponseTime: string | null;
  sslWarranty: string | null;
  domainTransferTime: string | null;
  stats: { value: string; label: string }[];
}

export interface SiteInfo {
  company: {
    name: string;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    address: string | null;
    hours: string | null;
  };
  claims: SiteClaims;
  /** Legal pages an admin has published. */
  legal: { slug: string; title: string }[];
}

export type BillingCycle = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'BIENNIAL' | 'TRIENNIAL' | 'ONE_TIME';

export interface CatalogPrice {
  cycle: BillingCycle;
  currency: string;
  price: number;
  renewalPrice: number;
  listPrice: number | null;
  setupFee: number;
}

export interface CatalogPlan {
  slug: string;
  name: string;
  description: string | null;
  isFeatured: boolean;
  features: { label: string; value: string | null; highlight: boolean }[];
  prices: CatalogPrice[];
}

export interface CatalogProduct {
  slug: string;
  name: string;
  type: string;
  category: string;
  tagline: string | null;
  description: string | null;
  plans: CatalogPlan[];
}

export interface PublicTestimonial {
  id: string;
  quote: string;
  authorName: string;
  authorRole: string | null;
  rating: number | null;
  isSample: boolean;
}

export interface PublicFaq {
  id: string;
  topic: string;
  question: string;
  answer: string;
}

export interface PublicProject {
  slug: string;
  title: string;
  clientName: string;
  category: string;
  summary: string;
  description: string | null;
  scope: string[];
  tags: string[];
  imageUrl: string | null;
  projectUrl: string | null;
  isSample: boolean;
}

export interface LegalDoc {
  slug: string;
  title: string;
  intro: string;
  sections: { heading: string; body: string[]; bullets: string[] }[];
  showDraftNotice: boolean;
  updatedOn: string | null;
}

export interface InquiryPayload {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  service: string;
  budget?: string;
  message: string;
  consent: boolean;
  website?: string;
}

/**
 * Read-only access to the public website API. Responses are cached per page load;
 * a failed request degrades to "nothing to show" so a content outage never blanks a page.
 */
@Injectable({ providedIn: 'root' })
export class PublicApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${RUNTIME_CONFIG.apiBaseUrl}/api/v1/public`;
  private readonly cache = new Map<string, Observable<unknown>>();

  private get<T>(path: string, fallback: T): Observable<T> {
    let hit = this.cache.get(path) as Observable<T> | undefined;
    if (!hit) {
      hit = this.http.get<T>(`${this.base}/${path}`).pipe(
        catchError(() => of(fallback)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.cache.set(path, hit);
    }
    return hit;
  }

  site(): Observable<SiteInfo | null> {
    return this.get<SiteInfo | null>('site', null);
  }

  catalog(): Observable<CatalogProduct[]> {
    return this.get<{ data: CatalogProduct[] }>('catalog', { data: [] }).pipe(map((r) => r.data));
  }

  testimonials(placement?: string): Observable<PublicTestimonial[]> {
    return this.get<{ data: PublicTestimonial[] }>(`testimonials${placement ? `?placement=${placement}` : ''}`, { data: [] }).pipe(map((r) => r.data));
  }

  faqs(topic: string): Observable<PublicFaq[]> {
    return this.get<{ data: PublicFaq[] }>(`faqs?topic=${encodeURIComponent(topic)}`, { data: [] }).pipe(map((r) => r.data));
  }

  projects(): Observable<PublicProject[]> {
    return this.get<{ data: PublicProject[] }>('projects', { data: [] }).pipe(map((r) => r.data));
  }

  /** Emits null when the document is not published (404) or unreachable. */
  legal(slug: string): Observable<LegalDoc | null> {
    return this.get<LegalDoc | null>(`legal/${slug}`, null);
  }

  /** Not cached: every submission is a new request. Errors propagate to the form. */
  submitInquiry(payload: InquiryPayload): Observable<{ received: boolean }> {
    return this.http.post<{ received: boolean }>(`${this.base}/inquiries`, payload);
  }
}
