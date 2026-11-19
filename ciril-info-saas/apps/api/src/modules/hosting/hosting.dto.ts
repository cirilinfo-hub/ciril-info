import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { ListQueryDto } from '../../common/http/pagination.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SetUpHostingDto {
  @ApiProperty({ description: 'The paid subscription to set up.' }) @IsUUID('4') subscriptionId!: string;
  @ApiProperty({ example: 'example.com' }) @Transform(trim) @IsString() @Length(4, 300, { message: 'Enter the domain name you want to host.' }) domain!: string;
}

export const ACCOUNT_STATUSES = ['PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'FAILED', 'TERMINATED'] as const;

export class AdminHostingListQuery extends ListQueryDto {
  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES }) @IsOptional() @IsIn(ACCOUNT_STATUSES) status?: (typeof ACCOUNT_STATUSES)[number];
}

export class SuspendDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 255, { message: 'Give a reason of 3 to 255 characters.' }) @MaxLength(255) reason!: string;
}
