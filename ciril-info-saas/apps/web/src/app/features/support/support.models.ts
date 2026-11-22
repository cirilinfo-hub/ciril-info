import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'AWAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketCategory = 'BILLING' | 'HOSTING' | 'DOMAIN' | 'EMAIL' | 'WEBSITE' | 'TECHNICAL' | 'SALES' | 'OTHER';

export const STATUS_LABEL: Record<TicketStatus, { label: string; cls: string }> = {
  OPEN: { label: 'Open', cls: 'cf-badge-info' },
  IN_PROGRESS: { label: 'In progress', cls: 'cf-badge-info' },
  AWAITING_CUSTOMER: { label: 'Waiting for you', cls: 'cf-badge-warning' },
  RESOLVED: { label: 'Resolved', cls: 'cf-badge-success' },
  CLOSED: { label: 'Closed', cls: 'cf-badge-neutral' },
};
/** What staff see: the same states, from their side. */
export const STAFF_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open', IN_PROGRESS: 'In progress', AWAITING_CUSTOMER: 'Awaiting customer', RESOLVED: 'Resolved', CLOSED: 'Closed',
};
export const PRIORITY_LABEL: Record<TicketPriority, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };
export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  BILLING: 'Billing', HOSTING: 'Hosting', DOMAIN: 'Domains', EMAIL: 'Email', WEBSITE: 'Website', TECHNICAL: 'Technical', SALES: 'Sales', OTHER: 'Other',
};
export const STATUSES = Object.keys(STATUS_LABEL) as TicketStatus[];
export const PRIORITIES = Object.keys(PRIORITY_LABEL) as TicketPriority[];
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as TicketCategory[];

export interface TicketRow {
  id: string;
  ref: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  lastReplyAt: string | null;
}

export interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/** Hands a downloaded file to the browser. The file needs the sign-in token, so a plain link cannot be used. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const toForm = (fields: Record<string, string>, files: File[]) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const file of files) f.append('files', file, file.name);
  return f;
};

export interface TicketMessage {
  id: string;
  body: string;
  createdAt: string;
  fromStaff: boolean;
  authorName: string;
  isYou?: boolean;
  isInternal?: boolean;
  attachments: Attachment[];
}

export interface TicketDetail extends TicketRow {
  resolvedAt: string | null;
  messages: TicketMessage[];
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; pageCount: number };
}

/** Customer-portal tickets (X-Tenant-Id is added by the interceptor). */
@Injectable()
export class SupportApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(AuthService).api}/tickets`;

  list(page = 1, status = '', search = '') {
    return firstValueFrom(this.http.get<Paged<TicketRow>>(this.base, { params: { page, pageSize: 20, ...(status ? { status } : {}), ...(search ? { search } : {}) } }));
  }
  get(id: string) {
    return firstValueFrom(this.http.get<TicketDetail>(`${this.base}/${id}`));
  }
  create(body: { subject: string; category: TicketCategory; priority: TicketPriority; message: string }, files: File[] = []) {
    return firstValueFrom(this.http.post<TicketRow>(this.base, files.length ? toForm(body, files) : body));
  }
  reply(id: string, body: string, files: File[] = []) {
    return firstValueFrom(this.http.post<TicketDetail>(`${this.base}/${id}/messages`, files.length ? toForm({ body }, files) : { body }));
  }
  download(ticketId: string, fileId: string) {
    return firstValueFrom(this.http.get(`${this.base}/${ticketId}/attachments/${fileId}`, { responseType: 'blob' }));
  }
  close(id: string) {
    return firstValueFrom(this.http.post<TicketDetail>(`${this.base}/${id}/close`, {}));
  }
}

export interface AdminTicketRow extends TicketRow {
  tenant: { id: string; name: string };
  openedBy: { id: string; firstName: string; lastName: string; email: string };
  assignee: { id: string; firstName: string; lastName: string; email: string } | null;
}
export interface AdminTicketDetail extends AdminTicketRow {
  resolvedAt: string | null;
  messages: TicketMessage[];
}

/** Admin-portal support inbox. */
@Injectable()
export class AdminSupportApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(AuthService).api}/admin/tickets`;

  list(page: number, f: { status: string; assignee: string; priority: string; search: string }) {
    const params: Record<string, string | number> = { page, pageSize: 20 };
    for (const [k, v] of Object.entries(f)) if (v) params[k] = v;
    return firstValueFrom(this.http.get<Paged<AdminTicketRow>>(this.base, { params }));
  }
  get(id: string) {
    return firstValueFrom(this.http.get<AdminTicketDetail>(`${this.base}/${id}`));
  }
  reply(id: string, body: string, isInternal: boolean, files: File[] = []) {
    return firstValueFrom(this.http.post<AdminTicketDetail>(`${this.base}/${id}/messages`, files.length ? toForm({ body, isInternal: String(isInternal) }, files) : { body, isInternal }));
  }
  download(ticketId: string, fileId: string) {
    return firstValueFrom(this.http.get(`${this.base}/${ticketId}/attachments/${fileId}`, { responseType: 'blob' }));
  }
  update(id: string, patch: { status?: TicketStatus; priority?: TicketPriority; assigneeId?: string | null }) {
    return firstValueFrom(this.http.patch<AdminTicketDetail>(`${this.base}/${id}`, patch));
  }
}
