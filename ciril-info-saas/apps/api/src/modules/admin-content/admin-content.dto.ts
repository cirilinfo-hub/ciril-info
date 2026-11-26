import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { ListQueryDto } from '../../common/http/pagination.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimList = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '') : value;
/** An empty string from a form means "clear it". */
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugMsg = { message: 'Use lowercase letters, numbers and hyphens only.' };
const URL_OPTS = { protocols: ['http', 'https'], require_protocol: true } ;
const IMAGE_REF = /^(\/uploads\/images\/[0-9a-f-]{36}\.(png|jpg|webp)|https?:\/\/\S+)$/;
const URL_MSG = { message: 'Enter a full web address starting with https://' };

export const PRODUCT_TYPES = [
  'WEB_HOSTING', 'WORDPRESS_HOSTING', 'CLOUD_HOSTING', 'VPS_HOSTING', 'DOMAIN', 'BUSINESS_EMAIL',
  'WEBSITE_DESIGN', 'WEBSITE_DEVELOPMENT', 'WEBSITE_MAINTENANCE', 'SEO', 'DIGITAL_MARKETING',
] as const;
export const PUBLISH_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export const BILLING_CYCLES = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'BIENNIAL', 'TRIENNIAL', 'ONE_TIME'] as const;
export const INQUIRY_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED', 'SPAM'] as const;

// ---------- testimonials ----------
export class TestimonialPatchDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 600) quote?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 120) authorName?: string;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(160) authorRole?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number | null;
  @IsOptional() @Transform(trimList) @IsArray() @ArrayMaxSize(12) @Matches(/^[a-z0-9-]{1,40}$/, { each: true }) placements?: string[];
  @IsOptional() @IsBoolean() consentConfirmed?: boolean;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(255) consentNote?: string | null;
  @IsOptional() @IsBoolean() isPublished?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}
export class TestimonialDto extends TestimonialPatchDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 600) override quote: string = '';
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) override authorName: string = '';
}

// ---------- FAQs ----------
export class FaqPatchDto {
  @IsOptional() @Transform(trim) @IsString() @Matches(/^[a-z0-9-]{1,64}$/, { message: 'Topic: lowercase letters, numbers and hyphens.' }) topic?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 255) question?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 4000) answer?: string;
  @IsOptional() @IsBoolean() isPublished?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}
export class FaqDto extends FaqPatchDto {
  @ApiProperty() @Transform(trim) @IsString() @Matches(/^[a-z0-9-]{1,64}$/, { message: 'Topic: lowercase letters, numbers and hyphens.' }) override topic: string = '';
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 255) override question: string = '';
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 4000) override answer: string = '';
}
export class FaqListQuery extends ListQueryDto {
  @IsOptional() @IsString() @Matches(/^[a-z0-9-]{1,64}$/) topic?: string;
}

// ---------- projects ----------
export class ProjectPatchDto {
  @IsOptional() @Transform(trim) @IsString() @Matches(SLUG, slugMsg) @MaxLength(120) slug?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 160) title?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 160) clientName?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 64) category?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 400) summary?: string;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(8000) description?: string | null;
  @IsOptional() @Transform(trimList) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(200, { each: true }) scope?: string[];
  @IsOptional() @Transform(trimList) @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  /** An uploaded image ("/uploads/images/<id>.png") or, for older records, a full web address. */
  @IsOptional() @Transform(blankToNull) @Matches(IMAGE_REF, { message: 'Upload an image, or use a full web address starting with https://' }) @MaxLength(512) imageUrl?: string | null;
  @IsOptional() @Transform(blankToNull) @IsUrl(URL_OPTS, URL_MSG) @MaxLength(512) projectUrl?: string | null;
  @IsOptional() @IsBoolean() isPublished?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}
export class ProjectDto extends ProjectPatchDto {
  @ApiProperty() @Transform(trim) @IsString() @Matches(SLUG, slugMsg) @MaxLength(120) override slug: string = '';
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 160) override title: string = '';
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 160) override clientName: string = '';
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 64) override category: string = '';
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 400) override summary: string = '';
}

// ---------- catalogue ----------
export class ProductPatchDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 160) name?: string;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(255) tagline?: string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(8000) description?: string | null;
  @IsOptional() @IsIn(PUBLISH_STATUSES) status?: (typeof PUBLISH_STATUSES)[number];
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}
export class ProductDto extends ProductPatchDto {
  @ApiProperty() @Transform(trim) @IsString() @Matches(SLUG, slugMsg) @MaxLength(120) slug!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 160) override name: string = '';
  @ApiProperty({ enum: PRODUCT_TYPES }) @IsIn(PRODUCT_TYPES) type!: (typeof PRODUCT_TYPES)[number];
  @ApiProperty() @Transform(trim) @IsString() @Matches(SLUG) categorySlug!: string;
}

export class PlanPatchDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 120) name?: string;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsIn(PUBLISH_STATUSES) status?: (typeof PUBLISH_STATUSES)[number];
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
  /** The package (WHM) or service plan (Plesk) name on the hosting panel. Must match the panel exactly. */
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(120) panelPackage?: string | null;
  /** With several servers: only servers with this panel take the plan. Null: any server. */
  @IsOptional() @Transform(blankToNull) @IsIn(['CPANEL', 'PLESK', 'FASTPANEL']) hostingPanel?: 'CPANEL' | 'PLESK' | 'FASTPANEL' | null;
  /** Disk space in GB (stored as the plan's disk_gb limit). FASTPANEL sets it as the account's disk quota. Null clears it. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }) @Min(0.1) @Max(100_000) diskGb?: number | null;
}
export class PlanDto extends PlanPatchDto {
  @ApiProperty() @Transform(trim) @IsString() @Matches(SLUG, slugMsg) @MaxLength(120) slug!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) override name: string = '';
}

export class FeatureDto {
  @Transform(trim) @IsString() @Length(1, 160) label!: string;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(80) value?: string | null;
  @IsOptional() @IsBoolean() highlight?: boolean;
}
export class PlanFeaturesDto {
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => FeatureDto) features!: FeatureDto[];
}

const money = { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false };
export class PriceDto {
  @ApiProperty({ enum: BILLING_CYCLES }) @IsIn(BILLING_CYCLES) billingCycle!: (typeof BILLING_CYCLES)[number];
  @ApiProperty() @IsNumber(money) @Min(0) @Max(100_000_000) price!: number;
  @ApiProperty() @IsNumber(money) @Min(0) @Max(100_000_000) renewalPrice!: number;
  @IsOptional() @IsNumber(money) @Min(0) @Max(100_000_000) listPrice?: number | null;
  @IsOptional() @IsNumber(money) @Min(0) @Max(100_000_000) setupFee?: number;
}

// ---------- inquiries ----------
export class InquiryListQuery extends ListQueryDto {
  @IsOptional() @IsIn(INQUIRY_STATUSES) status?: (typeof INQUIRY_STATUSES)[number];
}
export class InquiryStatusDto {
  @IsIn(INQUIRY_STATUSES) status!: (typeof INQUIRY_STATUSES)[number];
}
