// src/modules/auth/auth.service.ts
// TEC Auth Service — Production Ready v2.0
// Fixed: Prisma path, bcrypt, Pi Network verification, error handling

import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import axios from 'axios';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

interface PiUserDTO {
  uid: string;
  username: string;
}

interface TokenPayload {
  sub: string;
  email?: string;
  pi_uid?: string;
  pi_username?: string;
}

interface AuthResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user: {
    id: string;
    email?: string;
    pi_uid?: string;
    pi_username?: string;
    created_at: Date;
  };
}

// ─────────────────────────────────────────
// Service
// ─────────────────────────────────────────

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly SALT_ROUNDS = 12;
  private readonly PI_API_URL = 'https://api.minepi.com';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ─────────────────────────────────────────
  // Pi Network Authentication (PRIMARY)
  // ─────────────────────────────────────────

  /**
   * تسجيل الدخول عبر Pi Network SDK
   * هذا هو Flow الرئيسي للمنصة
   */
  async loginWithPi(piAccessToken: string): Promise<AuthResponse> {
    if (!piAccessToken) {
      throw new BadRequestException('Pi access token is required');
    }

    // 1. التحقق من التوكن مع Pi Network API
    const piUser = await this.verifyPiToken(piAccessToken);

    // 2. البحث عن المستخدم أو إنشاؤه (Upsert)
    const user = await this.prisma.user.upsert({
      where: { pi_uid: piUser.uid },
      update: {
        pi_username: piUser.username,
        last_login: new Date(),
      },
      create: {
        pi_uid: piUser.uid,
        pi_username: piUser.username,
        last_login: new Date(),
      },
    });

    this.logger.log(`Pi login success: ${piUser.username} (${piUser.uid})`);

    return this.buildAuthResponse(user);
  }

  /**
   * التحقق من Pi Access Token مع Pi Network API
   */
  private async verifyPiToken(accessToken: string): Promise<PiUserDTO> {
    try {
      const response = await axios.get(`${this.PI_API_URL}/v2/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 10000,
      });

      const { uid, username } = response.data;

      if (!uid || !username) {
        throw new UnauthorizedException('Invalid Pi token response');
      }

      return { uid, username };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;

        if (status === 401) {
          throw new UnauthorizedException('Invalid or expired Pi token');
        }
        if (status === 429) {
          throw new BadRequestException('Pi API rate limit exceeded');
        }

        this.logger.error(`Pi API error: ${error.message}`, error.response?.data);
      }

      throw new UnauthorizedException('Failed to verify Pi token');
    }
  }

  // ─────────────────────────────────────────
  // Standard Auth (SECONDARY — للتطوير/Admin)
  // ─────────────────────────────────────────

  /**
   * تسجيل مستخدم جديد بإيميل وباسورد
   */
  async register(dto: RegisterDto): Promise<AuthResponse> {
    // 1. Validate input
    if (!dto.email && !dto.pi_uid) {
      throw new BadRequestException('Email or Pi UID is required');
    }

    // 2. التحقق من عدم وجود المستخدم مسبقاً
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          dto.email ? { email: dto.email } : undefined,
          dto.pi_uid ? { pi_uid: dto.pi_uid } : undefined,
        ].filter(Boolean) as any,
      },
    });

    if (existingUser) {
      throw new ConflictException(
        existingUser.email === dto.email
          ? 'Email already registered'
          : 'Pi account already registered',
      );
    }

    // 3. تشفير كلمة المرور
    const hashedPassword = dto.password
      ? await bcrypt.hash(dto.password, this.SALT_ROUNDS)
      : null;

    // 4. إنشاء المستخدم
    const user = await this.prisma.user.create({
      data: {
        email: dto.email ?? null,
        password: hashedPassword,
        pi_uid: dto.pi_uid ?? null,
        pi_username: dto.pi_username ?? null,
        last_login: new Date(),
      },
    });

    this.logger.log(`New user registered: ${user.email || user.pi_username}`);

    return this.buildAuthResponse(user);
  }

  /**
   * تسجيل الدخول بإيميل وباسورد
   */
  async login(dto: LoginDto): Promise<AuthResponse> {
    let user: any = null;

    // الدخول عبر Pi UID (بدون باسورد)
    if (dto.pi_uid) {
      user = await this.prisma.user.findUnique({
        where: { pi_uid: dto.pi_uid },
      });

      if (!user) {
        throw new UnauthorizedException('Pi account not found. Please register first.');
      }
    }
    // الدخول عبر الإيميل + باسورد
    else if (dto.email && dto.password) {
      user = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });

      if (!user || !user.password) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const isPasswordValid = await bcrypt.compare(dto.password, user.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid credentials');
      }
    } else {
      throw new BadRequestException('Provide either Pi UID or email + password');
    }

    // تحديث آخر تسجيل دخول
    await this.prisma.user.update({
      where: { id: user.id },
      data: { last_login: new Date() },
    });

    this.logger.log(`Login success: ${user.email || user.pi_username}`);

    return this.buildAuthResponse(user);
  }

  // ─────────────────────────────────────────
  // Token Management
  // ─────────────────────────────────────────

  /**
   * التحقق من JWT Token (يُستخدم في Gateway)
   */
  async validateToken(token: string): Promise<TokenPayload> {
    try {
      return this.jwtService.verify<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * الحصول على بيانات المستخدم من التوكن
   */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        pi_uid: true,
        pi_username: true,
        created_at: true,
        last_login: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  // ─────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────

  /**
   * بناء استجابة Auth الموحدة
   */
  private buildAuthResponse(user: any): AuthResponse {
    const expiresIn = this.configService.get<number>('JWT_EXPIRES_IN', 86400); // 24h default

    const payload: TokenPayload = {
      sub: user.id,
      email: user.email ?? undefined,
      pi_uid: user.pi_uid ?? undefined,
      pi_username: user.pi_username ?? undefined,
    };

    const token = this.jwtService.sign(payload, { expiresIn });

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      user: {
        id: user.id,
        email: user.email ?? undefined,
        pi_uid: user.pi_uid ?? undefined,
        pi_username: user.pi_username ?? undefined,
        created_at: user.created_at,
      },
    };
  }
}
