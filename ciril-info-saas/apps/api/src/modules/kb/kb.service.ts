import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { page, skipTake } from '../../common/http/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { parseKbBody } from './kb-body.js';
import type { KbArticleDto, KbArticleListQuery, KbArticlePatchDto, KbCategoryDto, KbCategoryPatchDto, KbPublicQuery } from './kb.dto.js';

/** Common words that say nothing about the topic ("my email will not send" → email, send). */
const STOP_WORDS = new Set(
  ('a an and are as at be but by can cannot could do does for from get got has have how i if in into is it its me my no not of on or our please ' +
    'so that the their them then there this to too up us was we what when where which why will with would you your').split(' '),
);

/** The words of a search worth matching: lowercased, without filler words, at most eight. */
export function searchWords(search: string | undefined): string[] {
  const words = (search ?? '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 8);
}

/** "all": every word must appear (the search box). "any": at least one (suggestions, ranked by how many match). */
function searchWhere(words: string[], match: 'all' | 'any' = 'all'): Prisma.KbArticleWhereInput {
  if (!words.length) return {};
  const one = (w: string): Prisma.KbArticleWhereInput => ({
    OR: [
      { title: { contains: w, mode: 'insensitive' } },
      { summary: { contains: w, mode: 'insensitive' } },
      { body: { contains: w, mode: 'insensitive' } },
    ],
  });
  return match === 'all' ? { AND: words.map(one) } : { OR: words.map(one) };
}

/** Public articles: published, in a category. */
const PUBLISHED: Prisma.KbArticleWhereInput = { status: 'PUBLISHED' };

/**
 * Help centre (knowledge base). Staff with kb:write write and publish articles; only
 * PUBLISHED articles are ever returned by the public reads. Every write is audited.
 */
@Injectable()
export class KbService {
  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
  ) {}

  private async run<T>(fn: () => Promise<T>, what: string): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'P2002') throw new ConflictException({ code: 'ALREADY_EXISTS', message: `${what} with this web address (slug) already exists.` });
      if (code === 'P2025') throw new NotFoundException({ code: 'NOT_FOUND', message: `${what} not found.` });
      if (code === 'P2003') throw new ConflictException({ code: 'CATEGORY_NOT_EMPTY', message: 'This category still has articles. Move or delete them first.' });
      throw e;
    }
  }
  private log(user: AuthUser, meta: RequestMeta, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) {
    return this.audit.record({ action, actorId: user.id, entityType, entityId, metadata, meta });
  }

  // ------------------------------------------------------------ admin: categories
  async listCategories() {
    const rows = await this.db.kbCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { articles: true } } },
    });
    const published = await this.db.kbArticle.groupBy({ by: ['categoryId'], where: PUBLISHED, _count: true });
    const pub = new Map(published.map((p) => [p.categoryId, p._count]));
    return {
      data: rows.map(({ _count, ...c }) => ({ ...c, articleCount: _count.articles, publishedCount: pub.get(c.id) ?? 0 })),
    };
  }

  async createCategory(user: AuthUser, dto: KbCategoryDto, meta: RequestMeta) {
    const row = await this.run(() => this.db.kbCategory.create({ data: dto }), 'A category');
    await this.log(user, meta, 'kb.category.create', 'kb_category', row.id, { slug: row.slug });
    return row;
  }

  async updateCategory(user: AuthUser, id: string, dto: KbCategoryPatchDto, meta: RequestMeta) {
    const row = await this.run(() => this.db.kbCategory.update({ where: { id }, data: dto }), 'Category');
    await this.log(user, meta, 'kb.category.update', 'kb_category', id, { fields: Object.keys(dto) });
    return row;
  }

  async deleteCategory(user: AuthUser, id: string, meta: RequestMeta) {
    await this.run(() => this.db.kbCategory.delete({ where: { id } }), 'Category');
    await this.log(user, meta, 'kb.category.delete', 'kb_category', id);
  }

  // -------------------------------------------------------------- admin: articles
  async listArticles(q: KbArticleListQuery) {
    const where: Prisma.KbArticleWhereInput = {
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...searchWhere(searchWords(q.search)),
    };
    const [rows, total] = await Promise.all([
      this.db.kbArticle.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        select: {
          id: true, slug: true, title: true, summary: true, status: true, isSample: true, sortOrder: true,
          publishedAt: true, updatedAt: true, category: { select: { id: true, name: true, slug: true } },
        },
        ...skipTake(q),
      }),
      this.db.kbArticle.count({ where }),
    ]);
    return page(rows, total, q);
  }

  async getArticle(id: string) {
    const row = await this.db.kbArticle.findUnique({ where: { id }, include: { category: { select: { id: true, name: true, slug: true } } } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Article not found.' });
    return row;
  }

  private async assertCategory(id: string) {
    if (!(await this.db.kbCategory.findUnique({ where: { id }, select: { id: true } }))) {
      throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'That category no longer exists.' });
    }
  }

  async createArticle(user: AuthUser, dto: KbArticleDto, meta: RequestMeta) {
    await this.assertCategory(dto.categoryId);
    const status = dto.status ?? 'DRAFT';
    const row = await this.run(
      () => this.db.kbArticle.create({ data: { ...dto, status, publishedAt: status === 'PUBLISHED' ? new Date() : null } }),
      'An article',
    );
    await this.log(user, meta, 'kb.article.create', 'kb_article', row.id, { slug: row.slug, status });
    return row;
  }

  async updateArticle(user: AuthUser, id: string, dto: KbArticlePatchDto, meta: RequestMeta) {
    const current = await this.db.kbArticle.findUnique({ where: { id }, select: { status: true, publishedAt: true } });
    if (!current) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Article not found.' });
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    // The first time an article is published it gets its publish date; later edits keep it.
    const publishedAt = dto.status === 'PUBLISHED' && !current.publishedAt ? new Date() : undefined;
    const row = await this.run(() => this.db.kbArticle.update({ where: { id }, data: { ...dto, ...(publishedAt ? { publishedAt } : {}) } }), 'Article');
    const action = dto.status && dto.status !== current.status ? `kb.article.${dto.status.toLowerCase()}` : 'kb.article.update';
    await this.log(user, meta, action, 'kb_article', id, { fields: Object.keys(dto) });
    return row;
  }

  async deleteArticle(user: AuthUser, id: string, meta: RequestMeta) {
    await this.run(() => this.db.kbArticle.delete({ where: { id } }), 'Article');
    await this.log(user, meta, 'kb.article.delete', 'kb_article', id);
  }

  // ---------------------------------------------------------------------- public
  /** Categories that have at least one published article, with counts. */
  async publicCategories() {
    const rows = await this.db.kbCategory.findMany({
      where: { articles: { some: PUBLISHED } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { slug: true, name: true, description: true, _count: { select: { articles: { where: PUBLISHED } } } },
    });
    return { data: rows.map(({ _count, ...c }) => ({ ...c, articleCount: _count.articles })) };
  }

  /**
   * Published articles, optionally in one category and matching a search. With a search, the
   * best matches come first: words found in the title count most, then the summary, then the text.
   */
  async publicArticles(q: KbPublicQuery) {
    const limit = q.limit ?? 50;
    const words = searchWords(q.search);
    // A search made only of filler words matches nothing rather than everything.
    if (q.search?.trim() && !words.length) return { data: [] };
    const rows = await this.db.kbArticle.findMany({
      where: { ...PUBLISHED, ...(q.category ? { category: { slug: q.category } } : {}), ...searchWhere(words, q.match ?? 'all') },
      orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }],
      take: words.length ? 200 : limit,
      select: {
        slug: true, title: true, summary: true, isSample: true, updatedAt: true, category: { select: { slug: true, name: true } },
        ...(words.length ? { body: true } : {}),
      },
    });
    if (!words.length) return { data: rows };
    const has = (text: string, w: string) => text.toLowerCase().includes(w);
    const score = (r: (typeof rows)[number]) =>
      words.reduce((n, w) => n + (has(r.title, w) ? 4 : 0) + (has(r.summary, w) ? 2 : 0) + (has((r as { body?: string }).body ?? '', w) ? 1 : 0), 0);
    const ranked = rows.map((r) => ({ r, s: score(r) })).sort((a, b) => b.s - a.s);
    return { data: ranked.slice(0, limit).map(({ r }) => { const { body: _body, ...rest } = r as typeof r & { body?: string }; return rest; }) };
  }

  /** One published article as display blocks, with others from its category. */
  async publicArticle(slug: string) {
    const a = await this.db.kbArticle.findFirst({
      where: { slug, ...PUBLISHED },
      include: { category: { select: { id: true, slug: true, name: true } } },
    });
    if (!a) throw new NotFoundException({ code: 'NOT_FOUND', message: 'This help article is not available.' });
    const related = await this.db.kbArticle.findMany({
      where: { ...PUBLISHED, categoryId: a.categoryId, id: { not: a.id } },
      orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }],
      take: 5,
      select: { slug: true, title: true },
    });
    return {
      slug: a.slug,
      title: a.title,
      summary: a.summary,
      isSample: a.isSample,
      blocks: parseKbBody(a.body),
      publishedAt: a.publishedAt,
      updatedAt: a.updatedAt,
      category: { slug: a.category.slug, name: a.category.name },
      related,
    };
  }
}
