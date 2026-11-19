import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ListQueryDto } from '../../common/http/pagination.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToUndefined = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);
const STATUSES = ['PENDING_REGISTRATION', 'ACTIVE', 'FAILED', 'CANCELLED', 'EXPIRED'] as const;

export class AdminRegistrationListQuery extends ListQueryDto {
  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @ApiPropertyOptional({ description: 'Only paid orders waiting for staff to register them.' })
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() needsAction?: boolean;
}

export class CompleteRegistrationDto {
  @ApiPropertyOptional({ description: 'The registrar order or reference, for your own records.' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) registrarRef?: string;
  @ApiPropertyOptional({ description: 'When the registration ends. Defaults to the years paid for, from today.' })
  @IsOptional() @Transform(blankToUndefined) @Type(() => Date) @IsDate({ message: 'Enter a valid expiry date.' }) expiresAt?: Date;
}

export class CannotRegisterDto {
  @ApiPropertyOptional({ description: 'Shown to the customer.' })
  @Transform(trim) @IsString() @MinLength(3, { message: 'Say why, so the customer is told.' }) @MaxLength(200) reason!: string;
}
