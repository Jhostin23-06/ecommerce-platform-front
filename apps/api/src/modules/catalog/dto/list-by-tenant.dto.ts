import { IsUUID } from 'class-validator';

export class ListByTenantDto {
  @IsUUID()
  tenantId!: string;
}
