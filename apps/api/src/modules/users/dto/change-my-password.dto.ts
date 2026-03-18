import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangeMyPasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
