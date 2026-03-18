import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class ListCategoriesDto {
  @IsUUID()
  tenantId!: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) {
      return undefined;
    }
    return String(value).toLowerCase() === 'true';
  })
  @IsBoolean()
  isActive?: boolean;
}
