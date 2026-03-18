import { IsOptional, IsUUID } from 'class-validator';

export class BillingSettingsQueryDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
