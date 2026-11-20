import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { ListQueryDto } from '../../common/http/pagination.js';

const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'VOID', 'REFUNDED'] as const;
const SUBSCRIPTION_STATUSES = ['PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'SUSPENDED'] as const;

export class AdminInvoiceListQuery extends ListQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES }) @IsOptional() @IsIn(INVOICE_STATUSES) status?: (typeof INVOICE_STATUSES)[number];
}

export class AdminSubscriptionListQuery extends ListQueryDto {
  @ApiPropertyOptional({ enum: SUBSCRIPTION_STATUSES }) @IsOptional() @IsIn(SUBSCRIPTION_STATUSES) status?: (typeof SUBSCRIPTION_STATUSES)[number];
}

export class VoidInvoiceDto {
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @Length(3, 255, { message: 'Give a reason of 3 to 255 characters.' }) reason!: string;
}

export class RefundDto {
  @ApiPropertyOptional({ description: 'Amount in rupees. Leave out to refund everything not yet refunded.' })
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter an amount with at most two decimals.' }) @Min(0.01) @Max(10_000_000) amount?: number;

  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @Length(3, 255, { message: 'Give a reason of 3 to 255 characters.' }) reason!: string;

  @ApiPropertyOptional({ description: 'On a full refund, also cancel the service the invoice paid for.' })
  @IsOptional() @IsBoolean() cancelService?: boolean;
}

export const MANUAL_METHODS = ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'OTHER'] as const;
export type ManualMethod = (typeof MANUAL_METHODS)[number];

/** Money that reached you outside the checkout: a bank transfer, a UPI payment, a cheque or cash. The whole outstanding amount is recorded. */
export class RecordPaymentDto {
  @ApiProperty({ enum: MANUAL_METHODS }) @IsIn(MANUAL_METHODS) method!: ManualMethod;

  @ApiPropertyOptional({ description: 'The bank reference (UTR), UPI transaction id or cheque number. Required except for cash and other.' })
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(80) reference?: string;

  @ApiProperty({ description: 'The day the money arrived, as YYYY-MM-DD.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Enter the date the money arrived.' }) receivedOn!: string;

  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(200) note?: string;

  @ApiPropertyOptional({ description: 'Sent once per form, so a double click records one payment.' })
  @IsOptional() @IsUUID('4') idempotencyKey?: string;
}
