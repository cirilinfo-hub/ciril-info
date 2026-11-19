import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';
import { ListQueryDto } from '../../common/http/pagination.js';

export const ORDERABLE_CYCLES = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'BIENNIAL', 'TRIENNIAL', 'ONE_TIME'] as const;

export class QuoteDto {
  @ApiPropertyOptional({ description: 'Plan id. Send this or planRef.' })
  @ValidateIf((o: QuoteDto) => !o.planRef) @IsUUID('4') planId?: string;

  @ApiPropertyOptional({ description: 'Plan reference "product-slug/plan-slug", as used by website links.', example: 'web-hosting/starter' })
  @ValidateIf((o: QuoteDto) => !o.planId) @Matches(/^[a-z0-9-]{1,120}\/[a-z0-9-]{1,120}$/, { message: 'Use the form product-slug/plan-slug.' }) planRef?: string;

  @ApiProperty({ enum: ORDERABLE_CYCLES }) @IsIn(ORDERABLE_CYCLES) billingCycle!: (typeof ORDERABLE_CYCLES)[number];
}

export class OrderDto extends QuoteDto {}

export class PayInvoiceDto {
  @ApiPropertyOptional({ description: 'Resend the same value to retry safely; a repeated key never charges twice.' })
  @IsOptional() @IsString() @Length(8, 80) idempotencyKey?: string;

  @ApiPropertyOptional({ enum: ['fail'], description: 'Mock gateway only (never in production).' })
  @IsOptional() @IsIn(['fail']) simulate?: 'fail';
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 255) reason?: string;
}

export class BillingListQuery extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
}
