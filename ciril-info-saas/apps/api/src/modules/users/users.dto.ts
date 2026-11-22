import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, MaxLength, MinLength } from 'class-validator';
import { ListQueryDto } from '../../common/http/pagination.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const STAFF_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_AGENT'] as const;
const USER_STATUSES = ['ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED'] as const;

export class StaffListQuery extends ListQueryDto {
  @ApiPropertyOptional({ enum: STAFF_ROLES }) @IsOptional() @IsIn(STAFF_ROLES) role?: (typeof STAFF_ROLES)[number];
  @ApiPropertyOptional({ enum: USER_STATUSES }) @IsOptional() @IsIn(USER_STATUSES) status?: (typeof USER_STATUSES)[number];
}

export class InviteStaffDto {
  @ApiProperty() @Transform(trim) @IsEmail({}, { message: 'Enter a valid email address.' }) @MaxLength(254) email!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) firstName!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) lastName!: string;
  @ApiProperty({ enum: STAFF_ROLES }) @IsIn(STAFF_ROLES) roleKey!: (typeof STAFF_ROLES)[number];
}

export class StaffRoleDto {
  @ApiProperty({ enum: STAFF_ROLES }) @IsIn(STAFF_ROLES) roleKey!: (typeof STAFF_ROLES)[number];
}

export class SetupAccountDto {
  @ApiProperty() @IsString() @Length(20, 128) token!: string;
  @ApiProperty() @IsString() @MinLength(10, { message: 'Use at least 10 characters.' }) @MaxLength(128) password!: string;
}

export class AuditQuery extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') actorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') tenantId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
