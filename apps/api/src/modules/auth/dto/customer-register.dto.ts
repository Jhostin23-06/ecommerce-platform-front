import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CustomerRegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
