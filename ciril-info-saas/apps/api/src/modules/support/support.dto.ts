import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { ListQueryDto } from '../../common/http/pagination.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const TICKET_CATEGORIES = ['BILLING', 'HOSTING', 'DOMAIN', 'EMAIL', 'WEBSITE', 'TECHNICAL', 'SALES', 'OTHER'] as const;
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
/** Customers choose how urgent it feels; only staff can mark a ticket urgent. */
export const CUSTOMER_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

export class CreateTicketDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 200, { message: 'Subject must be 5 to 200 characters.' }) subject!: string;
  @ApiProperty({ enum: TICKET_CATEGORIES }) @IsIn(TICKET_CATEGORIES) category!: (typeof TICKET_CATEGORIES)[number];
  @ApiPropertyOptional({ enum: CUSTOMER_PRIORITIES }) @IsOptional() @IsIn(CUSTOMER_PRIORITIES) priority?: (typeof CUSTOMER_PRIORITIES)[number];
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 10_000, { message: 'Describe the problem in 10 to 10,000 characters.' }) message!: string;
}

export class ReplyDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 10_000, { message: 'Write a message of up to 10,000 characters.' }) body!: string;
}

export class StaffReplyDto extends ReplyDto {
  @ApiPropertyOptional({ description: 'Internal notes are never shown to the customer.' })
  // A multipart form sends every field as text, so "true" and "false" are accepted too.
  @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() isInternal?: boolean;
}

export class TicketListQuery extends ListQueryDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES }) @IsOptional() @IsIn(TICKET_STATUSES) status?: (typeof TICKET_STATUSES)[number];
}

export class AdminTicketListQuery extends TicketListQuery {
  @ApiPropertyOptional({ description: '"me" for tickets assigned to the caller, "none" for unassigned.' })
  @IsOptional() @IsString() assignee?: string;
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES }) @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: (typeof TICKET_PRIORITIES)[number];
}

export class TicketPatchDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES }) @IsOptional() @IsIn(TICKET_STATUSES) status?: (typeof TICKET_STATUSES)[number];
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES }) @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: (typeof TICKET_PRIORITIES)[number];
  @ApiPropertyOptional({ description: 'Staff user id, or null to unassign (IsOptional lets null through).' })
  @IsOptional() @Transform(({ value }) => (value === '' ? null : value)) @IsUUID('4', { message: 'Choose a staff member.' }) assigneeId?: string | null;
}

