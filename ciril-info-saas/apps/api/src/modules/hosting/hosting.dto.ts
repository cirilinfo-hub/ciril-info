import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { ListQueryDto } from '../../common/http/pagination.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SetUpHostingDto {
  @ApiProperty({ description: 'The paid subscription to set up.' }) @IsUUID('4') subscriptionId!: string;
  @ApiProperty({ example: 'example.com' }) @Transform(trim) @IsString() @Length(4, 300, { message: 'Enter the domain name you want to host.' }) domain!: string;
}

export const ACCOUNT_STATUSES = ['PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'FAILED', 'TERMINATED'] as const;

export class AdminHostingListQuery extends ListQueryDto {
  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES }) @IsOptional() @IsIn(ACCOUNT_STATUSES) status?: (typeof ACCOUNT_STATUSES)[number];
  @ApiPropertyOptional({ description: 'Only accounts with a task waiting for staff.' })
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() needsAction?: boolean;
}

export class CompleteTaskDto {
  @ApiPropertyOptional({ description: 'The username you created on the panel. Required when creating an account.' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(16, { message: 'A panel username has at most 16 characters.' }) panelUsername?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(200) note?: string;
}

export class CannotCompleteDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 255, { message: 'Give a reason of 3 to 255 characters.' }) reason!: string;
}

export class SuspendDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 255, { message: 'Give a reason of 3 to 255 characters.' }) @MaxLength(255) reason!: string;
}
