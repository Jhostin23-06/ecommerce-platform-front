import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateOrderReturnDto {
  @IsUUID()
  orderId!: string;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  requestedAmount?: number;
}
