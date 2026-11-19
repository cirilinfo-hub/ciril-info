import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, type PipeTransform, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import type { RequestMeta, TenantContext } from '../../auth/auth.types.js';
import { CurrentTenant, ReqMeta, RequireTenant } from '../../auth/decorators.js';
import { DNS_TYPES, type DnsRecordInput, type DnsType, TTL_DEFAULT } from './dns-rules.js';
import { DnsService } from './dns.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const uuid = new ParseUUIDPipe({ version: '4' });

export class DnsRecordDto {
  @IsIn(DNS_TYPES) type!: DnsType;
  @Transform(trim) @IsString() @MaxLength(255) name!: string;
  @Transform(trim) @IsString() @MaxLength(2100) content!: string;
  @IsOptional() @Type(() => Number) @IsInt({ message: 'The TTL must be a whole number of seconds.' }) ttl?: number;
  @IsOptional() @Type(() => Number) @IsInt({ message: 'The priority must be a whole number.' }) priority?: number;

  toInput(): DnsRecordInput {
    return { type: this.type, name: this.name, content: this.content, ttl: this.ttl ?? TTL_DEFAULT, priority: this.priority ?? null };
  }
}

/** A record id is 16 hex characters, as made by recordId(). Anything else cannot be a record. */
class RecordIdPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (!/^[0-9a-f]{16}$/.test(value)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'That is not a record id.' });
    return value;
  }
}
const recordIdPipe = new RecordIdPipe();

/** Customer portal: DNS records of a registered domain. */
@ApiTags('domains · dns')
@Controller('domains/:id/dns')
export class DnsController {
  constructor(private readonly svc: DnsService) {}

  @Get() @RequireTenant('services:read')
  list(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string) { return this.svc.list(ctx, id); }

  @Post() @HttpCode(201) @Throttle({ default: { limit: 30, ttl: 60_000 } }) @RequireTenant('services:manage')
  create(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Body() dto: DnsRecordDto, @ReqMeta() meta: RequestMeta) { return this.svc.create(ctx, id, dto.toInput(), meta); }

  @Put(':recordId') @Throttle({ default: { limit: 30, ttl: 60_000 } }) @RequireTenant('services:manage')
  update(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Param('recordId', recordIdPipe) recordId: string, @Body() dto: DnsRecordDto, @ReqMeta() meta: RequestMeta) { return this.svc.update(ctx, id, recordId, dto.toInput(), meta); }

  @Delete(':recordId') @Throttle({ default: { limit: 30, ttl: 60_000 } }) @RequireTenant('services:manage')
  remove(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Param('recordId', recordIdPipe) recordId: string, @ReqMeta() meta: RequestMeta) { return this.svc.remove(ctx, id, recordId, meta); }
}
