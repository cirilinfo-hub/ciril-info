import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  data: NotificationItem[];
  meta: { page: number; pageSize: number; total: number; pageCount: number };
  unread: number;
}

/** Notifications for either portal. The unread count is shared so the bell and the list stay in step. */
@Injectable()
export class NotificationsApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  /** Same notices, different endpoint: customers and staff each read only their own. */
  private readonly base = `${this.auth.api}${this.auth.portal === 'admin' ? '/admin' : ''}/notifications`;
  /** Unread notices for the bell badge. */
  readonly unread = signal(0);

  list(page = 1, unreadOnly = false, pageSize = 20) {
    return firstValueFrom(this.http.get<NotificationPage>(this.base, { params: { page, pageSize, ...(unreadOnly ? { unread: 'true' } : {}) } })).then((r) => {
      this.unread.set(r.unread);
      return r;
    });
  }

  async refreshCount() {
    this.unread.set((await firstValueFrom(this.http.get<{ count: number }>(`${this.base}/unread-count`))).count);
  }

  async markRead(n: NotificationItem) {
    if (n.readAt) return;
    await firstValueFrom(this.http.post<void>(`${this.base}/${n.id}/read`, {}));
    this.unread.update((c) => Math.max(0, c - 1));
  }

  async markAllRead() {
    await firstValueFrom(this.http.post<{ updated: number }>(`${this.base}/read-all`, {}));
    this.unread.set(0);
  }
}
