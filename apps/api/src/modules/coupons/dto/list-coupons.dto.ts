import { IsOptional, IsUUID } from 'class-validator';

export class ListCouponsDto {
  @IsUUID()
  tenantId!: string;

  @IsOptional()
  code?: string;
}
