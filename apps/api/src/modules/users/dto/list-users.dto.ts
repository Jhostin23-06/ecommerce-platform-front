import { IsOptional, IsUUID } from 'class-validator';

export class ListUsersDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
