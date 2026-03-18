import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const PRODUCT_SORT_OPTIONS = [
  'newest',
  'oldest',
  'price_asc',
  'price_desc',
  'rating_desc',
  'name_asc',
] as const;

export type ProductSortOption = (typeof PRODUCT_SORT_OPTIONS)[number];

export class ListProductsDto {
  @IsUUID()
  tenantId!: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) {
      return undefined;
    }
    return String(value).toLowerCase() === 'true';
  })
  @IsBoolean()
  inStock?: boolean;

  @IsOptional()
  @IsIn(PRODUCT_SORT_OPTIONS)
  sortBy?: ProductSortOption;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) {
      return undefined;
    }
    return String(value).toLowerCase() === 'true';
  })
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
