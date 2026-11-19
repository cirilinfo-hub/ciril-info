import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
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
