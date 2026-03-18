import { IsString, IsNotEmpty } from 'class-validator';

export class PiLoginDto {
  @IsString()
  @IsNotEmpty()
  access_token: string;
}
