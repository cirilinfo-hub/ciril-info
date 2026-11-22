import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Standard list query: ?page=1&pageSize=20&sort=-createdAt&search=acme
 * Sort uses a leading "-" for descending. Each endpoint passes its own allow-list
 * of sortable fields to `orderBy()`; anything else is rejected.
 */
export class ListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ example: '-createdAt' })
  @IsOptional() @IsString() @MaxLength(40)
  sort?: string;

  @ApiPropertyOptional({ description: 'Free-text search' })
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(120)
  search?: string;
}

export interface Page<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; pageCount: number };
}

export function page<T>(data: T[], total: number, q: Pick<ListQueryDto, 'page' | 'pageSize'>): Page<T> {
  return { data, meta: { page: q.page, pageSize: q.pageSize, total, pageCount: Math.max(1, Math.ceil(total / q.pageSize)) } };
}

export const skipTake = (q: Pick<ListQueryDto, 'page' | 'pageSize'>) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });

/**
 * Translate "?sort=-createdAt" into a Prisma orderBy using an allow-list.
 * `fields` maps public sort keys to Prisma orderBy fragments.
 */
export function orderBy<O>(sort: string | undefined, fields: Record<string, (dir: 'asc' | 'desc') => O>, fallback: O): O {
  if (!sort) return fallback;
  const dir = sort.startsWith('-') ? 'desc' : 'asc';
  const key = sort.replace(/^-/, '');
  const f = fields[key];
  if (!f) {
    // Unknown sort keys are a client error, not silently ignored.
    throw new BadRequestException({ code: 'INVALID_SORT', message: 'Unsupported sort field.', details: { allowed: Object.keys(fields) } });
  }
  return f(dir);
}
