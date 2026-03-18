import { IsString, IsEmail, IsOptional, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MinLength(6)
  password?: string;

  @IsString()
  @IsOptional()
  pi_uid?: string;

  @IsString()
  @IsOptional()
  pi_username?: string;
}
