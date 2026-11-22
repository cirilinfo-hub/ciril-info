import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const INQUIRY_SERVICES = [
  'Web Design',
  'Web Development',
  'Digital Marketing',
  'Online Promotions',
  'Domain Services',
  'More than one service',
  'Business or partnership enquiry',
  'Not sure yet',
] as const;

export const INQUIRY_BUDGETS = ['Not decided yet', 'Small project', 'Mid-size project', 'Large project', 'Ongoing monthly support', 'Prefer to discuss'] as const;

export class CreateInquiryDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120, { message: 'Enter your name.' }) name!: string;
  @ApiProperty() @Transform(trim) @IsEmail({}, { message: 'Enter a valid email address.' }) @MaxLength(254) email!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(/^\+?[0-9 ()-]{6,24}$/, { message: 'Enter a valid phone number.' }) phone?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(160) company?: string;
  @ApiProperty({ enum: INQUIRY_SERVICES }) @IsIn(INQUIRY_SERVICES, { message: 'Choose the service you need.' }) service!: string;
  @ApiPropertyOptional({ enum: INQUIRY_BUDGETS }) @IsOptional() @IsIn(INQUIRY_BUDGETS) budget?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 1000, { message: 'Describe your project in 10 to 1000 characters.' }) message!: string;
  @ApiProperty({ description: 'Must be true: the visitor agrees to be contacted' })
  @Equals(true, { message: 'Please agree to be contacted about this enquiry.' })
  consent!: boolean;
  /** Honeypot: real visitors never see or fill this field. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) website?: string;
}
