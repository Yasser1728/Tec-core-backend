import {
  Controller, Post, Get, Body,
  Headers, UnauthorizedException,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthResponse } from './auth.types';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PiLoginDto } from './dto/pi-login.dto';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('pi-login')
  @HttpCode(HttpStatus.OK)
  async piLogin(@Body() dto: PiLoginDto): Promise<AuthResponse> {
    const token = dto.accessToken || dto.access_token;
    return this.authService.piLogin(token);
  }

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(dto);
  }

  @Get('me')
  async getMe(@Headers('authorization') authHeader: string) {
    if (!authHeader?.startsWith('Bearer '))
      throw new UnauthorizedException('Missing token');
    const token = authHeader.split(' ')[1];
    const payload = await this.authService.validateToken(token);
    return this.authService.getMe(payload.sub);
  }

  @Get('health')
  health() {
    return { status: 'ok', service: 'auth' };
  }
}
