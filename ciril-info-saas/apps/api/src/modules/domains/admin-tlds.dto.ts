import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { TLD_PATTERN } from './domain-rules.js';
import { MAX_PRICE } from './tld-pricing.js';

const clean = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/^\./, '') : value);
const MONEY = { message: 'Enter an amount in rupees, up to two decimals.' };
const MARKUP = { message: 'Enter the markup as a number, up to two decimals.' };
const MARKUP_TYPES = ['PERCENT', 'AMOUNT'] as const;
const ROUNDINGS = ['NONE', 'RUPEE', 'NINE'] as const;
export const MAX_IMPORT_ROWS = 500;
export const MAX_COST_LOOKUP = 60;

/** A price in rupees: 0 to ten million, two decimals at most. */
const Money = () => (target: object, key: string) => {
  Type(() => Number)(target, key);
  IsNumber({ maxDecimalPlaces: 2 }, MONEY)(target, key);
  Min(0)(target, key);
  Max(MAX_PRICE)(target, key);
};

/** A markup: percent (up to 1000%) or rupees. */
class MarkupFields {
  @IsIn(MARKUP_TYPES, { message: 'Choose percent or amount.' }) markupType!: (typeof MARKUP_TYPES)[number];
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, MARKUP) @Min(0) @Max(MAX_PRICE) markupValue!: number;
  @IsOptional() @IsIn(ROUNDINGS) markupRound?: (typeof ROUNDINGS)[number];
}

/**
 * A new ending. Either give the three selling prices (priced by hand), or give the three costs with a markup and the
 * selling prices are worked out from them.
 */
export class TldDto {
  @Transform(clean) @Matches(TLD_PATTERN, { message: 'Enter the ending such as com, in or co.in.' }) tld!: string;
  @IsOptional() @Money() registerPrice?: number;
  @IsOptional() @Money() renewPrice?: number;
  @IsOptional() @Money() transferPrice?: number;
  @IsOptional() @Money() costRegister?: number;
  @IsOptional() @Money() costRenew?: number;
  @IsOptional() @Money() costTransfer?: number;
  @IsOptional() @IsIn(MARKUP_TYPES, { message: 'Choose percent or amount.' }) markupType?: (typeof MARKUP_TYPES)[number];
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, MARKUP) @Min(0) @Max(MAX_PRICE) markupValue?: number;
  @IsOptional() @IsIn(ROUNDINGS) markupRound?: (typeof ROUNDINGS)[number];
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

/** The ending itself stays fixed once it exists; turn it off instead. `markupType: null` goes back to pricing by hand; a cost of null clears it. */
export class TldPatchDto {
  @IsOptional() @Money() registerPrice?: number;
  @IsOptional() @Money() renewPrice?: number;
  @IsOptional() @Money() transferPrice?: number;
  @IsOptional() @Money() costRegister?: number | null;
  @IsOptional() @Money() costRenew?: number | null;
  @IsOptional() @Money() costTransfer?: number | null;
  @IsOptional() @IsIn(MARKUP_TYPES, { message: 'Choose percent or amount.' }) markupType?: (typeof MARKUP_TYPES)[number] | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, MARKUP) @Min(0) @Max(MAX_PRICE) markupValue?: number;
  @IsOptional() @IsIn(ROUNDINGS) markupRound?: (typeof ROUNDINGS)[number];
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

/**
 * Change many prices at once. Pick the endings by id, or every ending (optionally only those matching a search).
 * basis COST: keep this markup on each ending and work its prices out from its costs (endings without all three costs are skipped).
 * basis CURRENT: raise today's selling prices once by the markup; the endings are then priced by hand.
 */
export class TldBulkDto extends MarkupFields {
  @ValidateIf((o: TldBulkDto) => !o.all) @IsArray() @ArrayMinSize(1, { message: 'Choose at least one ending.' }) @ArrayMaxSize(MAX_IMPORT_ROWS) @IsUUID('4', { each: true }) ids?: string[];
  @IsOptional() @IsBoolean() all?: boolean;
  @IsOptional() @Transform(clean) @MaxLength(80) search?: string;
  @IsIn(['COST', 'CURRENT']) basis!: 'COST' | 'CURRENT';
}

export class TldImportRow {
  @Transform(clean) @Matches(TLD_PATTERN, { message: 'Enter the ending such as com, in or co.in.' }) tld!: string;
  @Money() costRegister!: number;
  @Money() costRenew!: number;
  @Money() costTransfer!: number;
}

class ImportMarkup extends MarkupFields {}

/**
 * Costs from the registrar's price sheet, many endings at once. Existing endings get the new costs (and new prices if
 * they follow a markup). New endings need `markup` to get selling prices.
 */
export class TldImportDto {
  @IsArray() @ArrayMinSize(1, { message: 'Paste at least one ending.' }) @ArrayMaxSize(MAX_IMPORT_ROWS) @ValidateNested({ each: true }) @Type(() => TldImportRow) rows!: TldImportRow[];
  @IsOptional() @ValidateNested() @Type(() => ImportMarkup) markup?: ImportMarkup;
  /** Also put endings priced by hand onto `markup`. Off: their selling prices are left alone. */
  @IsOptional() @IsBoolean() repriceManual?: boolean;
  /** New endings go on sale straight away. Off: they are added switched off, to check first. */
  @IsOptional() @IsBoolean() activate?: boolean;
}

/** Endings to look up at the registrar: "com, in, .co.in" (commas or spaces), tidied and without repeats. */
export class TldCostQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? [...new Set(value.split(/[\s,]+/).map((t) => t.trim().toLowerCase().replace(/^\./, '')).filter(Boolean))] : value,
  )
  @IsArray() @ArrayMinSize(1, { message: 'Enter at least one ending.' }) @ArrayMaxSize(MAX_COST_LOOKUP, { message: `Look up at most ${MAX_COST_LOOKUP} endings at a time.` })
  @Matches(TLD_PATTERN, { each: true, message: 'Enter endings such as com, in or co.in.' })
  tlds!: string[];
}
