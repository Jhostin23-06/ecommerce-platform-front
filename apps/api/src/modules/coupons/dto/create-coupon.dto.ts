import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
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
  minQuantity?: number;

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

export class CreateCouponDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]+$/)
  code!: string;

  @IsEnum(CouponType)
  type!: CouponType;

  @IsOptional()
  @IsEnum(CouponScope)
  scope?: CouponScope;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  value!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUsage?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CouponRulesDto)
  rules?: CouponRulesDto;
}
