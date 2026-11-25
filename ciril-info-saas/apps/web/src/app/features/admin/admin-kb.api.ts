import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import type { Paged } from './admin-content.api';

export type KbStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface KbCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  articleCount: number;
  publishedCount: number;
}

export interface KbArticleRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: KbStatus;
  isSample: boolean;
  sortOrder: number;
  publishedAt: string | null;
  updatedAt: string;
  category: { id: string; name: string; slug: string };
}

export interface KbArticle extends KbArticleRow {
  categoryId: string;
  body: string;
}

/** Admin help centre (knowledge base) API. Needs the kb:write permission. */
@Injectable()
export class AdminKbApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(AuthService).api}/admin/kb`;

  categories = () => firstValueFrom(this.http.get<{ data: KbCategory[] }>(`${this.base}/categories`));
  createCategory = (body: object) => firstValueFrom(this.http.post<KbCategory>(`${this.base}/categories`, body));
  updateCategory = (id: string, body: object) => firstValueFrom(this.http.patch<KbCategory>(`${this.base}/categories/${id}`, body));
  deleteCategory = (id: string) => firstValueFrom(this.http.delete<void>(`${this.base}/categories/${id}`));

  articles = (q: { page?: number; categoryId?: string; status?: string; search?: string } = {}) => {
    const params: Record<string, string | number> = { page: q.page ?? 1, pageSize: 50 };
    if (q.categoryId) params['categoryId'] = q.categoryId;
    if (q.status) params['status'] = q.status;
    if (q.search) params['search'] = q.search;
    return firstValueFrom(this.http.get<Paged<KbArticleRow>>(`${this.base}/articles`, { params }));
  };
  article = (id: string) => firstValueFrom(this.http.get<KbArticle>(`${this.base}/articles/${id}`));
  createArticle = (body: object) => firstValueFrom(this.http.post<KbArticle>(`${this.base}/articles`, body));
  updateArticle = (id: string, body: object) => firstValueFrom(this.http.patch<KbArticle>(`${this.base}/articles/${id}`, body));
  deleteArticle = (id: string) => firstValueFrom(this.http.delete<void>(`${this.base}/articles/${id}`));
}

/** "Reset a mailbox password" → "reset-a-mailbox-password". */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/, '');
}
