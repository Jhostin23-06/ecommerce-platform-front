import { IsOptional, IsString, IsUUID, IsUrl } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsUUID()
  orderId!: string;

  @IsOptional()
  @IsUrl()
  successUrl?: string;

  @IsOptional()
  @IsUrl()
  cancelUrl?: string;

  @IsOptional()
  @IsString()
  customerEmail?: string;
}
