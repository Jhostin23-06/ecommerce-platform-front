import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateMyProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName!: string;
}
