import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { FulfillmentStatus } from '../order.entity';

export class UpdateFulfillmentStatusDto {
  @IsEnum(FulfillmentStatus)
  status!: FulfillmentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  assignedCourierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  assignedCourierPhone?: string;
}
