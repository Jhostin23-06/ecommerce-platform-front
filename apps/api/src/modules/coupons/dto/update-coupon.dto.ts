import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
  Matches,
  Min,
} from 'class-validator';
import { CouponScope, CouponType } from '../coupon.entity';

class CouponRulesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minQuantity?: number | null;

  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(50)
  productIds?: string[];

  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(50)
  categoryIds?: string[];

  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(50)
  requiredProductIds?: string[];

  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(50)
  requiredCategoryIds?: string[];
}

export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/)
  code?: string;

  @IsOptional()
  @IsEnum(CouponType)
  type?: CouponType;

  @IsOptional()
  @IsEnum(CouponScope)
  scope?: CouponScope;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  value?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUsage?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => CouponRulesDto)
  rules?: CouponRulesDto | null;
}
