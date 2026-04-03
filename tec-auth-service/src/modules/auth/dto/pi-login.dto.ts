import { IsString, IsNotEmpty } from 'class-validator';

export class PiLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'accessToken is required' })
  accessToken!: string;
}
