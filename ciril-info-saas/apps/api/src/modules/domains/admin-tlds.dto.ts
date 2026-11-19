import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, Matches, Max, Min } from 'class-validator';
import { TLD_PATTERN } from './domain-rules.js';

const clean = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/^\./, '') : value);
const MONEY = { message: 'Enter an amount in rupees, up to two decimals.' };

export class TldDto {
  @Transform(clean) @Matches(TLD_PATTERN, { message: 'Enter the ending such as com, in or co.in.' }) tld!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, MONEY) @Min(0) @Max(10_000_000) registerPrice!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, MONEY) @Min(0) @Max(10_000_000) renewPrice!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, MONEY) @Min(0) @Max(10_000_000) transferPrice!: number;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

/** The ending itself stays fixed once it exists; turn it off instead. */
export class TldPatchDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, MONEY) @Min(0) @Max(10_000_000) registerPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, MONEY) @Min(0) @Max(10_000_000) renewPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, MONEY) @Min(0) @Max(10_000_000) transferPrice?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}
