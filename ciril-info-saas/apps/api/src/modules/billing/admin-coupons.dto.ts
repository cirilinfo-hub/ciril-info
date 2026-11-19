import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDate, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const blankToNull = ({ value }: { value: unknown }) => (value === '' ? null : value);

export class CouponDto {
  @ApiProperty({ example: 'WELCOME10' }) @Transform(upper) @Matches(/^[A-Z0-9_-]{3,40}$/, { message: 'Use 3 to 40 letters, digits, dashes or underscores.' }) code!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(255) description?: string;
  @ApiProperty({ enum: ['PERCENT', 'FIXED'] }) @IsIn(['PERCENT', 'FIXED']) discountType!: 'PERCENT' | 'FIXED';
  @ApiProperty({ description: 'Percent (1 to 100) or a fixed amount in rupees.' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1_000_000) discountValue!: number;
  @ApiPropertyOptional({ description: 'Plans this code works on. Empty means every plan.' }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true }) planIds?: string[];
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) maxRedemptions?: number | null;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @Type(() => Date) @IsDate({ message: 'Enter a valid start date.' }) startsAt?: Date | null;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @Type(() => Date) @IsDate({ message: 'Enter a valid end date.' }) endsAt?: Date | null;
}

/** Code, type and value stay fixed once a coupon exists, so customers who used it can always be explained. */
export class CouponPatchDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true }) planIds?: string[];
  @IsOptional() @Transform(blankToNull) @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) maxRedemptions?: number | null;
  @IsOptional() @Transform(blankToNull) @Type(() => Date) @IsDate() startsAt?: Date | null;
  @IsOptional() @Transform(blankToNull) @Type(() => Date) @IsDate() endsAt?: Date | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
