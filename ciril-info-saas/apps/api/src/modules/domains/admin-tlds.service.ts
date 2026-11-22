import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { page, skipTake } from '../../common/http/pagination.js';
import type { ListQueryDto } from '../../common/http/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import type { TldDto, TldPatchDto } from './admin-tlds.dto.js';

const select = { id: true, tld: true, registerPrice: true, renewPrice: true, transferPrice: true, isActive: true, isFeatured: true, sortOrder: true, isSample: true, createdAt: true } as const;
const fixed = (n: number) => n.toFixed(2);

/** Admin-managed domain prices. Nothing is created automatically in production. */
@Injectable()
export class AdminTldsService {
  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListQueryDto) {
    const where = q.search ? { tld: { contains: q.search.replace(/^\./, ''), mode: 'insensitive' as const } } : {};
    const [rows, total] = await Promise.all([
      this.db.tldPrice.findMany({ where, select, ...skipTake(q), orderBy: [{ sortOrder: 'asc' }, { tld: 'asc' }] }),
      this.db.tldPrice.count({ where }),
    ]);
    return page(rows, total, q);
  }

  async create(user: AuthUser, dto: TldDto, meta: RequestMeta) {
    if (await this.db.tldPrice.findUnique({ where: { tld: dto.tld }, select: { id: true } })) {
      throw new ConflictException({ code: 'TLD_EXISTS', message: `.${dto.tld} is already in the price list.` });
    }
    const t = await this.db.tldPrice.create({
      data: { tld: dto.tld, registerPrice: fixed(dto.registerPrice), renewPrice: fixed(dto.renewPrice), transferPrice: fixed(dto.transferPrice), isFeatured: dto.isFeatured ?? false, sortOrder: dto.sortOrder ?? 0 },
      select,
    });
    await this.audit.record({ action: 'tld.create', actorId: user.id, entityType: 'tld_price', entityId: t.id, metadata: { tld: t.tld, register: t.registerPrice.toString() }, meta });
    return t;
  }

  async update(user: AuthUser, id: string, dto: TldPatchDto, meta: RequestMeta) {
    if (!(await this.db.tldPrice.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException({ code: 'TLD_NOT_FOUND', message: 'That ending is not in the price list.' });
    const t = await this.db.tldPrice.update({
      where: { id },
      data: {
        ...(dto.registerPrice !== undefined ? { registerPrice: fixed(dto.registerPrice) } : {}),
        ...(dto.renewPrice !== undefined ? { renewPrice: fixed(dto.renewPrice) } : {}),
        ...(dto.transferPrice !== undefined ? { transferPrice: fixed(dto.transferPrice) } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.isFeatured !== undefined ? { isFeatured: dto.isFeatured } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      select,
    });
    await this.audit.record({ action: 'tld.update', actorId: user.id, entityType: 'tld_price', entityId: id, metadata: { tld: t.tld, fields: Object.keys(dto) }, meta });
    return t;
  }
}
