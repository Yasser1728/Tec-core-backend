import { IsString, IsOptional } from 'class-validator';

export class PiLoginDto {
  @IsString()
  @IsOptional()
  accessToken?: string;

  @IsString()
  @IsOptional()
  access_token?: string;

  @IsString()
  @IsOptional()
  piUsername?: string;

  @IsString()
  @IsOptional()
  piUid?: string;
}
