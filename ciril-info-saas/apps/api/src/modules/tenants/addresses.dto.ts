import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { GST_STATES } from '../../common/india/gst-states.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const STATE_CODES = GST_STATES.map((s) => s.code);

export class AddressDto {
  @ApiPropertyOptional({ example: 'Head office' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(40) label?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200, { message: 'Enter the street address.' }) line1!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(200) line2?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80, { message: 'Enter the city.' }) city!: string;
  @ApiProperty({ description: 'GST state code, e.g. "29" for Karnataka. See GET /organisation/addresses/states.' })
  @IsIn(STATE_CODES, { message: 'Choose a state.' }) stateCode!: string;
  @ApiProperty({ example: '560001' }) @Transform(trim) @Matches(/^[1-9][0-9]{5}$/, { message: 'Enter a 6-digit PIN code.' }) postalCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class AddressPatchDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) label?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(3, 200, { message: 'Enter the street address.' }) line1?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) line2?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 80, { message: 'Enter the city.' }) city?: string;
  @IsOptional() @IsIn(STATE_CODES, { message: 'Choose a state.' }) stateCode?: string;
  @IsOptional() @Transform(trim) @Matches(/^[1-9][0-9]{5}$/, { message: 'Enter a 6-digit PIN code.' }) postalCode?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
