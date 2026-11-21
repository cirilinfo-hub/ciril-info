import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
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
