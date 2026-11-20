import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; pageCount: number };
}

export interface Testimonial {
  id: string;
  quote: string;
  authorName: string;
  authorRole: string | null;
  rating: number | null;
  placements: string[];
  isPublished: boolean;
  consentConfirmed: boolean;
  consentNote: string | null;
  isSample: boolean;
  sortOrder: number;
}
export interface Faq {
  id: string;
  topic: string;
  question: string;
  answer: string;
  isPublished: boolean;
  isSample: boolean;
  sortOrder: number;
}
export interface Project {
  id: string;
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
  isPublished: boolean;
  isSample: boolean;
  sortOrder: number;
}

export type PublishStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type BillingCycle = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'BIENNIAL' | 'TRIENNIAL' | 'ONE_TIME';
export interface AdminPrice {
  id: string;
  billingCycle: BillingCycle;
  currency: string;
  price: number;
  renewalPrice: number;
  listPrice: number | null;
  setupFee: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  current: boolean;
}
export interface AdminPlan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isFeatured: boolean;
  status: PublishStatus;
  isSample: boolean;
  features: { label: string; value: string | null; highlight: boolean }[];
  prices: AdminPrice[];
}
export interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  type: string;
  tagline: string | null;
  description: string | null;
  status: PublishStatus;
  category: { slug: string; name: string };
  plans: AdminPlan[];
}

export interface CompanyProfile {
  legalName: string;
  brandName: string;
  email: string;
  phone: string;
  whatsapp: string;
  businessHours: string;
  gstin: string;
  invoicePrefix: string;
  address: { line1: string; line2: string; city: string; state: string; stateCode: string; postalCode: string; country: string };
  bank: { accountName: string; bankName: string; accountNumber: string; ifsc: string; upiId: string };
}
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
export interface LegalSummary {
  slug: string;
  title: string;
  status: 'NOT_STARTED' | 'DRAFT' | 'PUBLISHED';
  updatedAt: string | null;
}
export interface LegalDoc {
  slug: string;
  title: string;
  intro: string;
  sections: { heading: string; body: string[]; bullets: string[] }[];
  status: 'DRAFT' | 'PUBLISHED';
  showDraftNotice: boolean;
  updatedOn: string | null;
  exists: boolean;
}
export type InquiryStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CLOSED' | 'SPAM';
export interface Inquiry {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  service: string | null;
  budget: string | null;
  message: string;
  status: InquiryStatus;
  createdAt: string;
}

/** Admin portal endpoints for website content, catalogue and enquiries. */
@Injectable()
export class AdminContentApi {
  private readonly http = inject(HttpClient);
  private readonly root = inject(AuthService).api;
  private readonly base = `${this.root}/admin`;
  private readonly get = <T>(path: string, params: Record<string, string | number> = {}) => firstValueFrom(this.http.get<T>(`${this.base}/${path}`, { params }));

  /** Uploads an image (PNG, JPEG or WebP, up to 3 MB) and returns the path to save on the record. */
  uploadImage = (file: File) => {
    const body = new FormData();
    body.append('file', file, file.name);
    return firstValueFrom(this.http.post<{ path: string }>(`${this.root}/uploads/images`, body));
  };
  /** Address to show an uploaded image (or a legacy web address) in the admin portal. */
  imageSrc = (ref: string | null | undefined) => (ref ? (ref.startsWith('/uploads/') ? `${this.root}${ref}` : ref) : null);

  // testimonials / FAQs / projects
  testimonials = (page = 1, search = '') => this.get<Paged<Testimonial>>('content/testimonials', { page, pageSize: 20, ...(search ? { search } : {}) });
  faqs = (page = 1, topic = '', search = '') =>
    this.get<Paged<Faq> & { topics: { topic: string; count: number }[] }>('content/faqs', { page, pageSize: 50, ...(topic ? { topic } : {}), ...(search ? { search } : {}) });
  projects = (page = 1, search = '') => this.get<Paged<Project>>('content/projects', { page, pageSize: 20, ...(search ? { search } : {}) });
  create = (kind: 'testimonials' | 'faqs' | 'projects', body: object) => firstValueFrom(this.http.post<{ id: string }>(`${this.base}/content/${kind}`, body));
  update = (kind: 'testimonials' | 'faqs' | 'projects', id: string, body: object) => firstValueFrom(this.http.patch<unknown>(`${this.base}/content/${kind}/${id}`, body));
  remove = (kind: 'testimonials' | 'faqs' | 'projects', id: string) => firstValueFrom(this.http.delete<void>(`${this.base}/content/${kind}/${id}`));

  // catalogue
  products = () => this.get<{ data: AdminProduct[] }>('catalog/products');
  categories = () => this.get<{ data: { slug: string; name: string }[] }>('catalog/categories');
  createProduct = (body: object) => firstValueFrom(this.http.post<{ id: string }>(`${this.base}/catalog/products`, body));
  updateProduct = (id: string, body: object) => firstValueFrom(this.http.patch<void>(`${this.base}/catalog/products/${id}`, body));
  createPlan = (productId: string, body: object) => firstValueFrom(this.http.post<{ id: string }>(`${this.base}/catalog/products/${productId}/plans`, body));
  updatePlan = (id: string, body: object) => firstValueFrom(this.http.patch<void>(`${this.base}/catalog/plans/${id}`, body));
  setFeatures = (id: string, features: { label: string; value?: string | null; highlight?: boolean }[]) =>
    firstValueFrom(this.http.put<void>(`${this.base}/catalog/plans/${id}/features`, { features }));
  addPrice = (id: string, body: object) => firstValueFrom(this.http.post<{ id: string }>(`${this.base}/catalog/plans/${id}/prices`, body));

  // settings
  company = () => this.get<CompanyProfile>('settings/company');
  saveCompany = (body: CompanyProfile) => firstValueFrom(this.http.put<CompanyProfile>(`${this.base}/settings/company`, body));
  claims = () => this.get<SiteClaims>('settings/claims');
  saveClaims = (body: SiteClaims) => firstValueFrom(this.http.put<SiteClaims>(`${this.base}/settings/claims`, body));
  legalList = () => this.get<{ data: LegalSummary[] }>('settings/legal');
  legal = (slug: string) => this.get<LegalDoc>(`settings/legal/${slug}`);
  saveLegal = (slug: string, body: Omit<LegalDoc, 'slug' | 'exists'>) => firstValueFrom(this.http.put<LegalDoc>(`${this.base}/settings/legal/${slug}`, body));

  // enquiries
  inquiries = (page = 1, status = '', search = '') =>
    this.get<Paged<Inquiry> & { counts: Partial<Record<InquiryStatus, number>> }>('inquiries', { page, pageSize: 20, ...(status ? { status } : {}), ...(search ? { search } : {}) });
  setInquiryStatus = (id: string, status: InquiryStatus) => firstValueFrom(this.http.patch<void>(`${this.base}/inquiries/${id}`, { status }));
}
