import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'el slug solo permite letras minusculas, numeros y guiones',
  })
  slug!: string;
}
