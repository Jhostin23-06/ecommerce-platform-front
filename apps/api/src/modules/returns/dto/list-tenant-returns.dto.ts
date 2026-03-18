import { IsOptional, IsUUID } from 'class-validator';

export class ListTenantReturnsDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
