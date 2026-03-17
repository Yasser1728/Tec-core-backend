// src/modules/auth/auth.controller.ts

import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
// تصحيح الاستيرادات للإشارة إلى الملفات مباشرة بدلاً من المجلد
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * مسار تسجيل مستخدم جديد
   */
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  /**
   * مسار تسجيل الدخول
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  /**
   * مسار خاص بتسجيل الدخول عبر Pi Network 
   * (يمكنك استخدامه إذا أردتِ فصل منطق Pi عن الدخول العادي)
   */
  @Post('pi-login')
  @HttpCode(HttpStatus.OK)
  async piLogin(@Body() loginDto: LoginDto) {
    // نستخدم نفس خدمة الـ login لأنها مهيأة بالفعل للتعامل مع pi_uid
    return this.authService.login(loginDto);
  }
}
