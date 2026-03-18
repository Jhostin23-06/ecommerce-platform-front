import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { FulfillmentType } from '../order.entity';

export class DeliveryAddressDto {
  @IsString()
  @MaxLength(120)
  fullName!: string;

  @IsString()
  @MaxLength(40)
  phone!: string;

  @IsString()
  @MaxLength(180)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  line2?: string;

  @IsString()
  @MaxLength(120)
  district!: string;

  @IsString()
  @MaxLength(120)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}

export class PickupDetailsDto {
  @IsUUID()
  pickupPointId!: string;

  @IsString()
  @MaxLength(120)
  windowLabel!: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

export class BillingDetailsDto {
  @IsIn(['receipt', 'invoice'])
  documentType!: 'receipt' | 'invoice';

  @IsString()
  @MaxLength(20)
  customerDocumentType!: string;

  @IsString()
  @MaxLength(40)
  customerDocumentNumber!: string;

  @IsString()
  @MaxLength(160)
  customerName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  customerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerAddress?: string;
}

export class CheckoutDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/)
  couponCode?: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deliveryDistrict?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deliveryWindow?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  shippingAddress?: DeliveryAddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PickupDetailsDto)
  pickup?: PickupDetailsDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fulfillmentNotes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  billing?: BillingDetailsDto;
}
