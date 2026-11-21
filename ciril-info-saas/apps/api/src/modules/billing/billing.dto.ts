import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';
import { ListQueryDto } from '../../common/http/pagination.js';

export const ORDERABLE_CYCLES = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'BIENNIAL', 'TRIENNIAL', 'ONE_TIME'] as const;

export class QuoteDto {
  @ApiPropertyOptional({ description: 'Plan id. Send this or planRef.' })
  @ValidateIf((o: QuoteDto) => !o.planRef) @IsUUID('4') planId?: string;

  @ApiPropertyOptional({ description: 'Plan reference "product-slug/plan-slug", as used by website links.', example: 'web-hosting/starter' })
  @ValidateIf((o: QuoteDto) => !o.planId) @Matches(/^[a-z0-9-]{1,120}\/[a-z0-9-]{1,120}$/, { message: 'Use the form product-slug/plan-slug.' }) planRef?: string;

  @ApiProperty({ enum: ORDERABLE_CYCLES }) @IsIn(ORDERABLE_CYCLES) billingCycle!: (typeof ORDERABLE_CYCLES)[number];

  @ApiPropertyOptional({ description: 'Coupon code, discounting the first term.' })
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value)) @IsString() @Length(2, 40) couponCode?: string;
}

export class OrderDto extends QuoteDto {}

/** The plan to move to at the next renewal. Send the plan id or its product/plan reference. */
export class ChangePlanDto {
  @ApiPropertyOptional() @ValidateIf((o: ChangePlanDto) => !o.planRef) @IsUUID('4') planId?: string;
  @ApiPropertyOptional({ example: 'web-hosting/business' })
  @ValidateIf((o: ChangePlanDto) => !o.planId) @Matches(/^[a-z0-9-]{1,120}\/[a-z0-9-]{1,120}$/, { message: 'Use the form product-slug/plan-slug.' }) planRef?: string;
}

export class PayInvoiceDto {
  @ApiPropertyOptional({ description: 'Resend the same value to retry safely; a repeated key never charges twice.' })
  @IsOptional() @IsString() @Length(8, 80) idempotencyKey?: string;

  @ApiPropertyOptional({ enum: ['fail'], description: 'Mock gateway only (never in production).' })
  @IsOptional() @IsIn(['fail']) simulate?: 'fail';

  @ApiPropertyOptional({ description: 'Save the card used (card only) and charge renewal invoices to it automatically.' })
  @IsOptional() @IsBoolean() saveCard?: boolean;
}

export class AutoPayDto {
  @ApiProperty({ description: 'Charge renewal invoices to the saved card automatically.' }) @IsBoolean() autoPay!: boolean;
}

/** What the provider's checkout hands the browser when the customer has paid. The signature is what we trust. */
export class ConfirmPaymentDto {
  @ApiProperty() @IsString() @Length(4, 80) providerOrderId!: string;
  @ApiProperty() @IsString() @Length(4, 80) providerPaymentId!: string;
  @ApiProperty() @IsString() @Length(16, 200) signature!: string;
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 255) reason?: string;
}

export class BillingListQuery extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
}
