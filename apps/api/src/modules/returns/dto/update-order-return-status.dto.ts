import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { OrderReturnStatus } from '../order-return.entity';

export class UpdateOrderReturnStatusDto {
  @IsIn([
    OrderReturnStatus.APPROVED,
    OrderReturnStatus.PICKUP_PENDING,
    OrderReturnStatus.PICKUP_ASSIGNED,
    OrderReturnStatus.PICKED_UP,
    OrderReturnStatus.RECEIVED,
    OrderReturnStatus.REJECTED,
    OrderReturnStatus.REFUNDED,
  ])
  status!:
    | OrderReturnStatus.APPROVED
    | OrderReturnStatus.PICKUP_PENDING
    | OrderReturnStatus.PICKUP_ASSIGNED
    | OrderReturnStatus.PICKED_UP
    | OrderReturnStatus.RECEIVED
    | OrderReturnStatus.REJECTED
    | OrderReturnStatus.REFUNDED;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminNote?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  refundAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientRequestId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  pickupCourierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  pickupCourierPhone?: string;

  @IsOptional()
  @IsISO8601()
  pickupScheduledAt?: string;

  @IsOptional()
  @IsISO8601()
  pickupCompletedAt?: string;
}
