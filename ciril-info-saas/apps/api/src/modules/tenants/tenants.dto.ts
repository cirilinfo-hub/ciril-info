import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ListQueryDto } from '../../common/http/pagination.js';
import { ASSIGNABLE_TENANT_ROLES, type AssignableTenantRole } from './tenant-roles.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

/** Indian GSTIN: 2-digit state, 10-char PAN, entity, Z, checksum. */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export class UpdateOrganisationDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 160) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(160) companyName?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsEmail({}, { message: 'Enter a valid email address.' }) billingEmail?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @Matches(/^\+?[0-9 ()-]{6,24}$/, { message: 'Enter a valid phone number.' }) phone?: string | null;
  @ApiPropertyOptional({ description: '15-character GSTIN' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value))
  @Matches(GSTIN, { message: 'Enter a valid 15-character GSTIN.' })
  gstin?: string | null;
}

export class InviteMemberDto {
  @ApiProperty() @Transform(trim) @IsEmail({}, { message: 'Enter a valid email address.' }) @MaxLength(254) email!: string;
  @ApiProperty({ enum: ASSIGNABLE_TENANT_ROLES }) @IsIn(ASSIGNABLE_TENANT_ROLES) roleKey!: AssignableTenantRole;
}

export class ChangeRoleDto {
  @ApiProperty({ enum: ASSIGNABLE_TENANT_ROLES }) @IsIn(ASSIGNABLE_TENANT_ROLES) roleKey!: AssignableTenantRole;
}

export class AcceptInvitationNewUserDto {
  @ApiProperty() @IsString() @Length(20, 128) token!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) firstName!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) lastName!: string;
  @ApiProperty() @IsString() @MinLength(10, { message: 'Use at least 10 characters.' }) @MaxLength(128) password!: string;
}

export class AcceptInvitationDto {
  @ApiProperty() @IsString() @Length(20, 128) token!: string;
}

// ─── Admin ───

const TENANT_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const;

export class AdminTenantListQuery extends ListQueryDto {
  @ApiPropertyOptional({ enum: TENANT_STATUSES }) @IsOptional() @IsIn(TENANT_STATUSES) status?: (typeof TENANT_STATUSES)[number];
}

class OwnerDto {
  @ApiProperty() @Transform(trim) @IsEmail({}, { message: 'Enter a valid email address.' }) email!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) firstName!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) lastName!: string;
}

export class AdminCreateTenantDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 160) name!: string;
  @ApiProperty({ type: OwnerDto }) @ValidateNested() @Type(() => OwnerDto) owner!: OwnerDto;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @Matches(/^\+?[0-9 ()-]{6,24}$/) phone?: string | null;
}

export class AdminUpdateTenantDto extends UpdateOrganisationDto {
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) internalNotes?: string | null;
}

export class SuspendDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 255) reason!: string;
}

export class ActivityQuery extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) action?: string;
}
