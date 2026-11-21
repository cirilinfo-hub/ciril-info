import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, Equals, IsArray, IsEmail, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_YEARS } from './domain-rules.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class DomainQuoteQuery {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(253) domain!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_YEARS) years = 1;
}

export class DomainOrderDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(253) domain!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_YEARS) years = 1;
}

export class RenewDomainDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_YEARS) years = 1;
}

export class TransferQuoteQuery {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(253) domain!: string;
}

export class TransferOrderDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(253) domain!: string;
  @Transform(trim) @IsString() @MaxLength(200) authCode!: string;
}

/** The nameservers to point the domain at, one per entry (checked and cleaned up by the service). */
export class NameserversDto {
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(253, { each: true }) nameservers!: string[];
}

/** A domain's contact details. Lengths follow what registries accept. */
export class DomainContactDto {
  @Transform(trim) @IsString() @Length(1, 30) firstName!: string;
  @Transform(trim) @IsString() @Length(1, 30) lastName!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) organisation?: string;
  @Transform(trim) @IsEmail({}, { message: 'Enter a valid email address.' }) @MaxLength(80) email!: string;
  @Transform(trim) @IsString() @Length(6, 24) phone!: string;
  @Transform(trim) @IsString() @Length(1, 41) address1!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(41) address2?: string;
  @Transform(trim) @IsString() @Length(1, 30) city!: string;
  @Transform(trim) @IsString() @Length(1, 30) state!: string;
  @Transform(trim) @IsString() @Length(3, 12) postalCode!: string;
  @Transform(trim) @Matches(/^[A-Za-z]{2}$/, { message: 'Use the two-letter country code, for example IN.' }) country!: string;
  /** The customer read the warning about the registry's confirmation emails and transfer lock. */
  @Equals(true, { message: 'Confirm that you have read the warning.' }) acknowledged!: boolean;
}
