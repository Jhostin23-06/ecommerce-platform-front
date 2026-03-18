import { IsEmail } from 'class-validator';

export class ResendVerificationByEmailDto {
  @IsEmail()
  email!: string;
}
