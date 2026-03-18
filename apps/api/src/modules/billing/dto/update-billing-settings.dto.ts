import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { BillingEnvironment, BillingProvider } from '../entities/billing-settings.entity';

export class UpdateBillingSettingsDto {
  @IsOptional()
  @IsEnum(BillingProvider)
  provider?: BillingProvider;

  @IsOptional()
  @IsEnum(BillingEnvironment)
  environment?: BillingEnvironment;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/)
  issuerRuc?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  issuerBusinessName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  issuerAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  invoiceSeries?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  receiptSeries?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  creditNoteSeries?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  apiBaseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  apiToken?: string;

  @IsOptional()
  @IsObject()
  extraConfig?: Record<string, unknown>;
}
