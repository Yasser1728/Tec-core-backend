// src/modules/auth/auth.service.ts

import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service'; 
// استيراد كل DTO من ملفه الخاص لحل مشكلة "no exported member"
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { env } from '../../config/env'; 
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterDto) {
    if (!dto.email && !dto.pi_uid) {
      throw new BadRequestException('Email or Pi UID is required');
    }

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

    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : null;

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password_hash: passwordHash,
        pi_uid: dto.pi_uid, // تم تفعيل هذا الحقل الآن في الـ DTO
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
      },
    });

    return user;
  }

  async login(dto: LoginDto) {
    // ... منطق تسجيل الدخول المعتمد على الـ DTO المحدث
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          dto.email ? { email: dto.email } : undefined,
          dto.pi_uid ? { pi_uid: dto.pi_uid } : undefined,
        ].filter(Boolean),
      },
    });

    if (!user) throw new UnauthorizedException('User not found');
    
    // توليد التوكنات كما في الكود السابق...
    return { 
      accessToken: '...', 
      refreshToken: '...', 
      user 
    };
  }
}
