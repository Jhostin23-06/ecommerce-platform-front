import { IsOptional, IsUUID } from 'class-validator';

export class ListTenantOrdersDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
