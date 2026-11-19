import { Injectable } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { AuthUser } from '../auth/auth.types.js';

const DAY = 86_400_000;

/**
 * Admin dashboard: real counts only. A section is included only when the caller's role
 * may read that data, and it is `null` otherwise. Billing figures come from /admin/billing/summary; nothing is estimated or invented.
 */
@Injectable()
export class AdminDashboardService {
  constructor(private readonly db: PlatformPrisma) {}

  async summary(user: AuthUser) {
    const can = (p: Parameters<ReadonlySet<never>['has']>[0] | string) => (user.platformPermissions as ReadonlySet<string>).has(p as string);
    const now = Date.now();
    const d7 = new Date(now - 7 * DAY);
    const d30 = new Date(now - 30 * DAY);

    const [customers, enquiries, content, staff, recentEnquiries, recentActivity, tickets, hosting, domains] = await Promise.all([
      can('tenants:read')
        ? Promise.all([
            this.db.tenant.count(),
            this.db.tenant.count({ where: { status: 'ACTIVE' } }),
            this.db.tenant.count({ where: { status: 'SUSPENDED' } }),
            this.db.tenant.count({ where: { createdAt: { gte: d30 } } }),
          ]).then(([total, active, suspended, newLast30Days]) => ({ total, active, suspended, newLast30Days }))
        : null,
      can('inquiries:read')
        ? Promise.all([
            this.db.contactInquiry.count({ where: { status: 'NEW' } }),
            this.db.contactInquiry.count({ where: { createdAt: { gte: d7 } } }),
          ]).then(([newCount, last7Days]) => ({ new: newCount, last7Days }))
        : null,
      can('content:read') || can('products:read')
        ? Promise.all([
            this.db.product.count({ where: { status: 'PUBLISHED' } }),
            this.db.plan.count({ where: { status: 'PUBLISHED' } }),
            this.db.plan.count({ where: { status: 'DRAFT' } }),
            this.db.portfolioProject.count({ where: { isPublished: true } }),
            this.db.testimonial.count({ where: { isPublished: true } }),
            this.db.faq.count({ where: { isPublished: true } }),
          ]).then(([products, plans, draftPlans, projects, testimonials, faqs]) => ({ products, plans, draftPlans, projects, testimonials, faqs }))
        : null,
      can('users:read') ? this.db.user.count({ where: { platformRoleId: { not: null }, status: 'ACTIVE' } }).then((active) => ({ active })) : null,
      can('inquiries:read')
        ? this.db.contactInquiry.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: { id: true, name: true, email: true, service: true, status: true, createdAt: true },
          })
        : null,
      can('audit:read')
        ? this.db.auditLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 8,
            select: { id: true, action: true, createdAt: true, actor: { select: { firstName: true, lastName: true, email: true } } },
          })
        : null,
      can('support:read')
        ? Promise.all([
            this.db.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
            this.db.supportTicket.count({ where: { status: 'OPEN', assigneeId: null } }),
          ]).then(([open, unassigned]) => ({ open, unassigned }))
        : null,
      can('hosting:read')
        ? Promise.all([
            this.db.provisioningJob.count({ where: { status: 'AWAITING_STAFF' } }),
            this.db.provisioningJob.count({ where: { status: 'FAILED', hostingAccount: { status: { notIn: ['CANCELLED', 'TERMINATED'] } } } }),
          ]).then(([waiting, failed]) => ({ waiting, failed }))
        : null,
      // Paid domain orders waiting for staff to register them.
      can('domains:read') ? this.db.domain.count({ where: { status: 'PENDING_REGISTRATION', orderInvoice: { status: 'PAID' } } }).then((waiting) => ({ waiting })) : null,
    ]);
    return { customers, enquiries, content, staff, recentEnquiries, recentActivity, tickets, hosting, domains };
  }
}
