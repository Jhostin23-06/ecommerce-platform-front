import { IsOptional, IsUUID } from 'class-validator';

export class CartTenantQueryDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
