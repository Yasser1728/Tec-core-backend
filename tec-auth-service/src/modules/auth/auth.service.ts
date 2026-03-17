// src/modules/auth/auth.service.ts

import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
// استيراد Prisma من البنية التحتية للمشروع
import { PrismaService } from '../../infra/prisma/prisma.service'; 

// استيراد الـ DTOs بشكل منفصل لحل مشكلة المسارات في TypeScript
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
// تصحيح مسار ملف الإعدادات
import { env } from '../../config/env'; 
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * تسجيل مستخدم جديد يدعم البريد الإلكتروني أو Pi Network
   */
  async register(dto: RegisterDto) {
    if (!dto.email && !dto.pi_uid) {
      throw new BadRequestException('Email or Pi UID is required');
    }

    // التحقق من وجود المستخدم مسبقاً بناءً على البريد أو معرف Pi
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          dto.email ? { email: dto.email } : undefined,
          dto.pi_uid ? { pi_uid: dto.pi_uid } : undefined,
        ].filter(Boolean),
      },
    });

    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    // تشفير كلمة المرور إذا تم توفيرها
    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, 10)
      : null;

    // إنشاء الحساب الجديد في قاعدة البيانات
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password_hash: passwordHash,
        pi_uid: dto.pi_uid,
        pi_username: dto.pi_username,
        role: 'user',
        kyc_status: 'pending',
      },
      select: {
        id: true,
        email: true,
        role: true,
        pi_uid: true,
        pi_username: true,
        created_at: true,
      },
    });

    // تسجيل العملية في سجلات المراجعة
    await this.prisma.auditLog.create({
      data: {
        user_id: user.id,
        action: 'register',
        metadata: {
          email: dto.email,
          pi_uid: dto.pi_uid,
        },
      },
    });

    return user;
  }

  /**
   * تسجيل الدخول التقليدي أو عبر Pi Network
   */
  async login(dto: LoginDto) {
    if (!dto.email && !dto.pi_uid) {
      throw new BadRequestException('Email or Pi UID is required');
    }

    // البحث عن المستخدم
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          dto.email ? { email: dto.email } : undefined,
          dto.pi_uid ? { pi_uid: dto.pi_uid } : undefined,
        ].filter(Boolean),
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // التحقق من صحة كلمة المرور للبريد الإلكتروني
    if (dto.email && dto.password) {
      const valid =
        user.password_hash &&
        (await bcrypt.compare(dto.password, user.password_hash));

      if (!valid) {
        await this.recordLoginAttempt(dto.email, false);
        throw new UnauthorizedException('Invalid credentials');
      }
    }

    // التحقق من تسجيل الدخول عبر Pi UID
    if (dto.pi_uid && !dto.password && !dto.email) {
      if (!user.pi_uid) {
        throw new UnauthorizedException('Invalid Pi login');
      }
    }

    // توليد رموز الوصول (Tokens) باستخدام القيم من ملف البيئة
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      pi_uid: user.pi_uid,
    };

    const accessToken = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: '1h',
    });

    const refreshToken = jwt.sign(
      { sub: user.id, session: uuidv4() },
      env.REFRESH_TOKEN_SECRET,
      { expiresIn: '7d' },
    );

    // إنشاء جلسة العمل في قاعدة البيانات
    const sessionId = uuidv4();
    await this.prisma.session.create({
      data: {
        id: sessionId,
        user_id: user.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // حفظ رمز التجديد (Refresh Token)
    await this.prisma.refreshToken.create({
      data: {
        id: uuidv4(),
        user_id: user.id,
        token: refreshToken,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        device: dto.device || 'unknown',
        ip_address: dto.ip_address || 'unknown',
      },
    });

    // تسجيل محاولة ناجحة
    await this.recordLoginAttempt(
      user.email || user.pi_uid || 'unknown',
      true,
    );

    return {
      accessToken,
      refreshToken,
      sessionId,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        pi_uid: user.pi_uid,
        pi_username: user.pi_username,
      },
    };
  }

  private async recordLoginAttempt(
    identifier: string,
    success: boolean,
  ) {
    await this.prisma.loginAttempt.create({
      data: {
        email: identifier,
        success,
        created_at: new Date(),
      },
    });
  }
}
