import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { ListQueryDto } from '../../common/http/pagination.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** An empty string from a form means "clear it". */
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugMsg = { message: 'Use lowercase letters, numbers and hyphens only.' };

export const KB_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type KbStatus = (typeof KB_STATUSES)[number];

// ---------- categories ----------
export class KbCategoryPatchDto {
  @IsOptional() @Transform(trim) @IsString() @Matches(SLUG, slugMsg) @MaxLength(80) slug?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 120) name?: string;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(400) description?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}
export class KbCategoryDto extends KbCategoryPatchDto {
  @ApiProperty() @Transform(trim) @IsString() @Matches(SLUG, slugMsg) @MaxLength(80) override slug: string = '';
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) override name: string = '';
}

// ---------- articles ----------
export class KbArticlePatchDto {
  @IsOptional() @IsUUID('4', { message: 'Choose a category.' }) categoryId?: string;
  @IsOptional() @Transform(trim) @IsString() @Matches(SLUG, slugMsg) @MaxLength(120) slug?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 200) title?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 400) summary?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 30000, { message: 'Write the article (up to 30,000 characters).' }) body?: string;
  @IsOptional() @IsIn(KB_STATUSES) status?: KbStatus;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}
export class KbArticleDto extends KbArticlePatchDto {
  @ApiProperty() @IsUUID('4', { message: 'Choose a category.' }) override categoryId: string = '';
  @ApiProperty() @Transform(trim) @IsString() @Matches(SLUG, slugMsg) @MaxLength(120) override slug: string = '';
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) override title: string = '';
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 400) override summary: string = '';
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 30000, { message: 'Write the article (up to 30,000 characters).' }) override body: string = '';
}
export class KbArticleListQuery extends ListQueryDto {
  @IsOptional() @IsUUID('4') categoryId?: string;
  @IsOptional() @IsIn(KB_STATUSES) status?: KbStatus;
}

// ---------- public ----------
export class KbPublicQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsString() @Matches(SLUG) @MaxLength(80) category?: string;
  /** all (default): every word must appear. any: at least one, best matches first (used for suggestions). */
  @IsOptional() @IsIn(['all', 'any']) match?: 'all' | 'any';
  /** How many to return (suggestions on the ticket form ask for a few). */
  @IsOptional() @Transform(({ value }) => (value === undefined ? undefined : Number(value))) @IsInt() @Min(1) @Max(50) limit?: number;
}
