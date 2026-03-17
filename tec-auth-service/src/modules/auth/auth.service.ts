// src/modules/auth/auth.service.ts
// TEC Auth Service v2.1 — All errors fixed

import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  AuthResponse,
  TokenPayload,
  PiUserDTO,
} from './auth.types';
import * as bcrypt from 'bcrypt';
import axios from 'axios';

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
  // Pi Network Login (PRIMARY)
  // ─────────────────────────────────────────

  async piLogin(piAccessToken: string): Promise<AuthResponse> {
    if (!piAccessToken) {
      throw new BadRequestException('Pi access token is required');
    }

    const piUser = await this.verifyPiToken(piAccessToken);

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

    this.logger.log(`Pi login: ${piUser.username}`);
    return this.buildAuthResponse(user);
  }

  private async verifyPiToken(accessToken: string): Promise<PiUserDTO> {
    try {
      const { data } = await axios.get(`${this.PI_API_URL}/v2/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });

      if (!data.uid || !data.username) {
        throw new UnauthorizedException('Invalid Pi token response');
      }

      return { uid: data.uid, username: data.username };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new UnauthorizedException('Invalid or expired Pi token');
        }
      }
      throw new UnauthorizedException('Failed to verify Pi token');
    }
  }

  // ─────────────────────────────────────────
  // Standard Auth
  // ─────────────────────────────────────────

  async register(dto: RegisterDto): Promise<AuthResponse> {
    if (!dto.email && !dto.pi_uid) {
      throw new BadRequestException('Email or Pi UID is required');
    }

    const conditions: any[] = [];
    if (dto.email) conditions.push({ email: dto.email });
    if (dto.pi_uid) conditions.push({ pi_uid: dto.pi_uid });

    const existingUser = await this.prisma.user.findFirst({
      where: { OR: conditions },
    });

    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    const hashedPassword = dto.password
      ? await bcrypt.hash(dto.password, this.SALT_ROUNDS)
      : null;

    const user = await this.prisma.user.create({
      data: {
        email: dto.email ?? null,
        password: hashedPassword,
        pi_uid: dto.pi_uid ?? null,
        pi_username: dto.pi_username ?? null,
        last_login: new Date(),
      },
    });

    this.logger.log(`Registered: ${user.email || user.pi_username}`);
    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    let user: any = null;

    if (dto.pi_uid) {
      user = await this.prisma.user.findUnique({ where: { pi_uid: dto.pi_uid } });
      if (!user) throw new UnauthorizedException('Pi account not found');
    } else if (dto.email && dto.password) {
      user = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (!user?.password) throw new UnauthorizedException('Invalid credentials');

      const valid = await bcrypt.compare(dto.password, user.password);
      if (!valid) throw new UnauthorizedException('Invalid credentials');
    } else {
      throw new BadRequestException('Provide Pi UID or email + password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { last_login: new Date() },
    });

    this.logger.log(`Login: ${user.email || user.pi_username}`);
    return this.buildAuthResponse(user);
  }

  // ─────────────────────────────────────────
  // Token Utilities
  // ─────────────────────────────────────────

  async validateToken(token: string): Promise<TokenPayload> {
    try {
      return this.jwtService.verify<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

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

    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }

  // ─────────────────────────────────────────
  // Private
  // ─────────────────────────────────────────

  private buildAuthResponse(user: any): AuthResponse {
    const expiresIn = Number(
      this.configService.get<number>('JWT_EXPIRES_IN', 86400),
    );

    const payload: TokenPayload = {
      sub: user.id,
      email: user.email ?? undefined,
      pi_uid: user.pi_uid ?? undefined,
      pi_username: user.pi_username ?? undefined,
    };

    return {
      access_token: this.jwtService.sign(payload, { expiresIn }),
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
