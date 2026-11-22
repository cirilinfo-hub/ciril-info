import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { CurrentUser, ReqMeta, RequirePlatform } from '../auth/decorators.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const select = { id: true, name: true, code: true, rate: true, country: true, isDefault: true, isActive: true, createdAt: true } as const;

export class TaxRateDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @Transform(upper) @Matches(/^[A-Z]{2,16}$/, { message: 'Use 2 to 16 capital letters, such as GST or IGST.' }) code!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }, { message: 'The rate is a percentage with up to three decimals.' }) @Min(0) @Max(100) rate!: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

/** The code stays fixed once a rate exists. A default is changed by making another rate the default. */
export class TaxRatePatchDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100) rate?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

/**
 * Admin-managed GST rates. New invoices add tax from the default active rate for India; an invoice that has been issued keeps
 * the rate it was issued with, so changing a rate here never rewrites the past.
 */
@Injectable()
export class AdminTaxService {
  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return { data: await this.db.taxRate.findMany({ select, orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { createdAt: 'asc' }] }) };
  }

  async create(user: AuthUser, dto: TaxRateDto, meta: RequestMeta) {
    const t = await this.db.$transaction(async (tx) => {
      if (await tx.taxRate.findFirst({ where: { code: dto.code, country: 'IN', rate: dto.rate.toFixed(3), isActive: true }, select: { id: true } })) {
        throw new ConflictException({ code: 'TAX_RATE_EXISTS', message: `A ${dto.code} rate of ${dto.rate}% already exists.` });
      }
      // The first rate ever added is the default, so tax is not silently left off.
      const hasDefault = await tx.taxRate.count({ where: { isDefault: true, isActive: true, country: 'IN' } });
      const makeDefault = dto.isDefault === true || hasDefault === 0;
      if (makeDefault) await tx.taxRate.updateMany({ where: { country: 'IN', isDefault: true }, data: { isDefault: false } });
      return tx.taxRate.create({ data: { name: dto.name, code: dto.code, rate: dto.rate.toFixed(3), country: 'IN', isDefault: makeDefault, isActive: true }, select });
    });
    await this.audit.record({ action: 'tax_rate.create', actorId: user.id, entityType: 'tax_rate', entityId: t.id, metadata: { code: t.code, rate: t.rate.toString(), isDefault: t.isDefault }, meta });
    return t;
  }

  async update(user: AuthUser, id: string, dto: TaxRatePatchDto, meta: RequestMeta) {
    if (dto.isDefault === false) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'To change the default, make another rate the default.' });
    const t = await this.db.$transaction(async (tx) => {
      const current = await tx.taxRate.findUnique({ where: { id }, select });
      if (!current) throw new NotFoundException({ code: 'TAX_RATE_NOT_FOUND', message: 'Tax rate not found.' });
      if (dto.isActive === false && current.isDefault) throw new ConflictException({ code: 'TAX_RATE_IS_DEFAULT', message: 'This is the default rate. Make another rate the default first.' });
      if (dto.isDefault === true && (dto.isActive === false || !current.isActive)) throw new ConflictException({ code: 'TAX_RATE_INACTIVE', message: 'A rate that is switched off cannot be the default.' });
      if (dto.isDefault === true) await tx.taxRate.updateMany({ where: { country: current.country, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      return tx.taxRate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.rate !== undefined ? { rate: dto.rate.toFixed(3) } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.isDefault === true ? { isDefault: true } : {}),
        },
        select,
      });
    });
    await this.audit.record({ action: 'tax_rate.update', actorId: user.id, entityType: 'tax_rate', entityId: id, metadata: { code: t.code, fields: Object.keys(dto), rate: t.rate.toString() }, meta });
    return t;
  }
}

const uuid = new ParseUUIDPipe({ version: '4' });

/** Admin portal: GST rates. Reading needs billing access; changing needs tax access. */
@ApiTags('admin · tax rates')
@Controller('admin/tax-rates')
export class AdminTaxController {
  constructor(private readonly svc: AdminTaxService) {}

  @Get() @RequirePlatform('billing:read')
  list() { return this.svc.list(); }

  @Post() @HttpCode(201) @RequirePlatform('tax:write')
  create(@CurrentUser() u: AuthUser, @Body() dto: TaxRateDto, @ReqMeta() meta: RequestMeta) { return this.svc.create(u, dto, meta); }

  @Patch(':id') @RequirePlatform('tax:write')
  update(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: TaxRatePatchDto, @ReqMeta() meta: RequestMeta) { return this.svc.update(u, id, dto, meta); }
}
