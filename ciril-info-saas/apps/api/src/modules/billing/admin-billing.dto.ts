import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
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
