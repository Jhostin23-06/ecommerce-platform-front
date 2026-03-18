import { IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RegisterDto } from './register.dto';

export class BootstrapRegisterDto {
  @ValidateNested()
  @Type(() => RegisterDto)
  register!: RegisterDto;

  @IsString()
  @MinLength(12)
  bootstrapToken!: string;
}
