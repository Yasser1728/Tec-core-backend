// src/modules/auth/auth.service.ts

import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  /**
   * تسجيل مستخدم جديد (يدعم Pi Network والمستخدمين العاديين)
   */
  async register(dto: RegisterDto) {
    // 1. التحقق من وجود المستخدم مسبقاً عبر الإيميل أو Pi UID
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.email },
          { pi_uid: dto.pi_uid || undefined }
        ]
      }
    });

    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    // 2. تشفير كلمة المرور إذا كانت موجودة
    const hashedPassword = dto.password 
      ? await bcrypt.hash(dto.password, 10) 
      : undefined;

    // 3. إنشاء المستخدم في قاعدة البيانات
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        pi_uid: dto.pi_uid,
        pi_username: dto.pi_username,
        // يمكن إضافة قيم افتراضية أخرى هنا
      }
    });

    return this.generateToken(user);
  }

  /**
   * تسجيل الدخول
   */
  async login(dto: LoginDto) {
    let user;

    // الدخول عبر Pi UID أو الإيميل
    if (dto.pi_uid) {
      user = await this.prisma.user.findUnique({ where: { pi_uid: dto.pi_uid } });
    } else {
      user = await this.prisma.user.findUnique({ where: { email: dto.email } });
      
      if (user && dto.password) {
        const isMatch = await bcrypt.compare(dto.password, user.password);
        if (!isMatch) user = null;
      }
    }

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateToken(user);
  }

  /**
   * دالة مساعدة لإنشاء التوكن
   */
  private generateToken(user: any) {
    const payload = { 
      sub: user.id, 
      email: user.email, 
      pi_uid: user.pi_uid 
    };
    
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        pi_username: user.pi_username
      }
    };
  }
}
