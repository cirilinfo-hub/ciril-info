import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { PORTALS, type Portal } from './auth.types.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) firstName!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) lastName!: string;
  @ApiProperty() @Transform(trim) @IsEmail({}, { message: 'Enter a valid email address.' }) @MaxLength(254) email!: string;
  @ApiProperty({ minLength: 10 }) @IsString() @MinLength(10, { message: 'Use at least 10 characters.' }) @MaxLength(128) password!: string;
  @ApiProperty({ description: 'Business or organisation name' }) @Transform(trim) @IsString() @Length(2, 160) organisationName!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(/^\+?[0-9 ()-]{6,24}$/, { message: 'Enter a valid phone number.' }) phone?: string;
  @ApiProperty({ description: 'Must be true: accepts the Terms and Privacy Policy' })
  @Equals(true, { message: 'Please accept the Terms and Privacy Policy.' })
  acceptTerms!: boolean;
}

export class LoginDto {
  @ApiProperty() @Transform(trim) @IsEmail({}, { message: 'Enter a valid email address.' }) @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @Length(1, 128) password!: string;
  @ApiProperty({ enum: PORTALS }) @IsIn(PORTALS) portal!: Portal;
}

export class MfaVerifyDto {
  @ApiProperty() @IsString() @MaxLength(2048) mfaToken!: string;
  @ApiPropertyOptional({ example: '123456' }) @IsOptional() @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code.' }) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(8, 32) recoveryCode?: string;
}

export class MfaCodeDto {
  @ApiProperty({ example: '123456' }) @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code.' }) code!: string;
}

export class MfaDisableDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code.' }) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(8, 32) recoveryCode?: string;
}

export class EmailDto {
  @ApiProperty() @Transform(trim) @IsEmail({}, { message: 'Enter a valid email address.' }) @MaxLength(254) email!: string;
}

export class ForgotPasswordDto extends EmailDto {
  @ApiProperty({ enum: PORTALS }) @IsIn(PORTALS) portal!: Portal;
}

export class TokenDto {
  @ApiProperty() @IsString() @Length(20, 128) token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @ApiProperty({ minLength: 10 }) @IsString() @MinLength(10, { message: 'Use at least 10 characters.' }) @MaxLength(128) password!: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @Length(1, 128) currentPassword!: string;
  @ApiProperty({ minLength: 10 }) @IsString() @MinLength(10, { message: 'Use at least 10 characters.' }) @MaxLength(128) newPassword!: string;
}

export class PortalQueryDto {
  @ApiProperty({ enum: PORTALS }) @IsIn(PORTALS) portal!: Portal;
}
