import { Type } from 'class-transformer';
import { IsString, MinLength, ValidateNested } from 'class-validator';
import { CreateTenantDto } from './create-tenant.dto';

export class BootstrapTenantDto {
  @ValidateNested()
  @Type(() => CreateTenantDto)
  tenant!: CreateTenantDto;

  @IsString()
  @MinLength(12)
  bootstrapToken!: string;
}
