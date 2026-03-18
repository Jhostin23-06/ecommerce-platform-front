import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateDeliveryZoneDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsArray()
  @Transform(({ value }) => (Array.isArray(value) ? value : []))
  districts!: string[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fee!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  freeShippingFrom?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  etaMinutes?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
