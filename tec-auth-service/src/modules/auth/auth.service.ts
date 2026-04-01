import {
  Injectable, UnauthorizedException,
  ConflictException, BadRequestException, Logger,
} from '@nestjs/common';
import { JwtService }                            from '@nestjs/jwt';
import { ConfigService }                         from '@nestjs/config';
import { PrismaService }                         from '../../prisma/prisma.service';
import { RegisterDto }                           from './dto/register.dto';
import { LoginDto }                              from './dto/login.dto';
import { AuthResponse, TokenPayload, PiUserDTO } from './auth.types';
import * as bcrypt                               from 'bcrypt';
import axios                                     from 'axios';
import Redis                                     from 'ioredis';

@Injectable()
export class AuthService {
  private readonly logger      = new Logger(AuthService.name);
  private readonly SALT_ROUNDS = 12;
  private readonly PI_API_URL  = 'https://api.minepi.com';
  private readonly redis: Redis | null = null;

  constructor(
    private readonly prisma:        PrismaService,
    private readonly jwtService:    JwtService,
    private readonly configService: ConfigService,
  ) {
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy:        (times) => Math.min(times * 100, 3000),
        enableOfflineQueue:   true,
        lazyConnect:          false,
      });
      this.redis.on('connect', () => this.logger.log('✅ Redis connected (auth-service)'));
      this.redis.on('error',   (err) => this.logger.warn(`⚠️ Redis error: ${err.message}`));
    }
  }

  // ── Pi Login ──────────────────────────────────────────────
  async piLogin(piAccessToken: string): Promise<AuthResponse> {
    if (!piAccessToken)
      throw new BadRequestException('Pi access token is required');

    const piUser = await this.verifyPiToken(piAccessToken);

    let isNewUser = false;
    const existing = await this.prisma.user.findUnique({ where: { pi_uid: piUser.uid } });
    if (!existing) isNewUser = true;

    const user = await this.prisma.user.upsert({
      where:  { pi_uid: piUser.uid },
      update: { pi_username: piUser.username },
      create: { pi_uid: piUser.uid, pi_username: piUser.username },
    });

    this.logger.log(`Pi login: ${piUser.username} (new: ${isNewUser})`);

    if (isNewUser && this.redis) {
      try {
        await this.redis.xadd('user.created', '*', 'data', JSON.stringify({
          userId:    user.id,
          piUserId:  user.pi_uid,
          username:  user.pi_username,
          timestamp: new Date().toISOString(),
        }));
        this.logger.log(`user.created event emitted: ${piUser.username}`);
      } catch (err) {
        this.logger.warn(`Failed to emit user.created: ${(err as Error).message}`);
      }
    }

    return this.buildAuthResponse(user, isNewUser);
  }

  // ── Verify Pi Token ───────────────────────────────────────
  private async verifyPiToken(accessToken: string): Promise<PiUserDTO> {
    try {
      const { data } = await axios.get(`${this.PI_API_URL}/v2/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });
      if (!data.uid || !data.username)
        throw new UnauthorizedException('Invalid Pi response');
      return { uid: data.uid, username: data.username };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401)
        throw new UnauthorizedException('Invalid or expired Pi token');
      throw new UnauthorizedException('Failed to verify Pi token');
    }
  }

  // ── Register ──────────────────────────────────────────────
  async register(dto: RegisterDto): Promise<AuthResponse> {
    const conditions: any[] = [];
    if (dto.email)  conditions.push({ email:  dto.email });
    if (dto.pi_uid) conditions.push({ pi_uid: dto.pi_uid });
    if (conditions.length === 0)
      throw new BadRequestException('Email or Pi UID is required');

    const existing = await this.prisma.user.findFirst({ where: { OR: conditions } });
    if (existing) throw new ConflictException('User already exists');

    const password_hash = dto.password
      ? await bcrypt.hash(dto.password, this.SALT_ROUNDS)
      : null;

    const user = await this.prisma.user.create({
      data: {
        email:        dto.email       ?? null,
        password_hash,
        pi_uid:       dto.pi_uid      ?? null,
        pi_username:  dto.pi_username ?? null,
      },
    });

    return this.buildAuthResponse(user, true);
  }

  // ── Login ─────────────────────────────────────────────────
  async login(dto: LoginDto): Promise<AuthResponse> {
    let user: any = null;

    if (dto.pi_uid) {
      user = await this.prisma.user.findUnique({ where: { pi_uid: dto.pi_uid } });
      if (!user) throw new UnauthorizedException('Pi account not found');
    } else if (dto.email && dto.password) {
      user = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (!user?.password_hash) throw new UnauthorizedException('Invalid credentials');
      const valid = await bcrypt.compare(dto.password, user.password_hash);
      if (!valid) throw new UnauthorizedException('Invalid credentials');
    } else {
      throw new BadRequestException('Provide Pi UID or email + password');
    }

    return this.buildAuthResponse(user, false);
  }

  // ── Validate Token ────────────────────────────────────────
  async validateToken(token: string): Promise<TokenPayload> {
    try {
      return this.jwtService.verify<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  // ── Get Me ────────────────────────────────────────────────
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: {
        id: true, pi_uid: true, pi_username: true,
        kyc_status: true, role: true, created_at: true,
      },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }

  // ── Refresh Token Rotation ────────────────────────────────
  async refreshToken(refreshToken: string): Promise<{ token: string }> {
    const jwtSecret        = this.configService.get<string>('JWT_SECRET', 'tec-dev-secret')!;
    const jwtRefreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET', jwtSecret)!;

    // 1. Verify refresh token — always HS256
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, { secret: jwtRefreshSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh')
      throw new UnauthorizedException('Not a refresh token');

    // 2. Check blacklist
    if (this.redis) {
      const blacklisted = await this.redis.get(`blacklist:${refreshToken}`);
      if (blacklisted) throw new UnauthorizedException('Refresh token already used');
    }

    // 3. Blacklist old refresh token
    const ttl = payload.exp - Math.floor(Date.now() / 1000);
    if (this.redis && ttl > 0) {
      await this.redis.setex(`blacklist:${refreshToken}`, ttl, '1');
    }

    // 4. Get user
    const user = await this.prisma.user.findUnique({
      where:  { id: payload.sub },
      select: { id: true, pi_uid: true, pi_username: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    // 5. New access token — algorithm من الـ module config
    const expiresIn      = this.configService.get<string>('JWT_EXPIRES_IN') ?? 86400;
    const newAccessToken = this.jwtService.sign(
      { sub: user.id, pi_uid: user.pi_uid, pi_username: user.pi_username },
      { expiresIn },
    );

    this.logger.log(`Token refreshed for user: ${user.id}`);
    return { token: newAccessToken };
  }

  // ── Logout — Blacklist token ──────────────────────────────
  async logout(token: string): Promise<{ success: boolean }> {
    if (!this.redis) return { success: true };
    try {
      const payload: any = this.jwtService.decode(token);
      if (payload?.exp) {
        const ttl = payload.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) await this.redis.setex(`blacklist:${token}`, ttl, '1');
      }
      this.logger.log(`Token blacklisted for user: ${payload?.sub}`);
      return { success: true };
    } catch {
      return { success: true };
    }
  }

  // ── Build Auth Response ───────────────────────────────────
  private buildAuthResponse(user: any, isNewUser: boolean): AuthResponse {
    const jwtSecret        = this.configService.get<string>('JWT_SECRET', 'tec-dev-secret')!;
    const jwtRefreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET', jwtSecret)!;

    const parseExpiry = (value: string | undefined, fallback: number): string | number => {
      if (!value) return fallback;
      const asNumber = Number(value);
      return isNaN(asNumber) ? value : asNumber;
    };

    const expiresIn        = parseExpiry(this.configService.get<string>('JWT_EXPIRES_IN'),         86400);
    const refreshExpiresIn = parseExpiry(this.configService.get<string>('JWT_REFRESH_EXPIRES_IN'), 604800);

    const payload: TokenPayload = {
      sub:         user.id,
      pi_uid:      user.pi_uid      ?? undefined,
      pi_username: user.pi_username ?? undefined,
    };

    // ── Access Token — algorithm بيتحدد من الـ module config ──
    const accessToken = this.jwtService.sign(payload, { expiresIn });

    // ── Refresh Token — always HS256 ──────────────────────────
    const refreshToken = this.jwtService.sign(
      { sub: user.id, type: 'refresh' },
      { secret: jwtRefreshSecret, expiresIn: refreshExpiresIn },
    );

    return {
      success: true,
      isNewUser,
      user: {
        id:               user.id,
        piId:             user.pi_uid      ?? '',
        piUsername:       user.pi_username ?? '',
        role:             user.role        ?? 'user',
        subscriptionPlan: null,
        createdAt:        user.created_at?.toISOString() ?? '',
      },
      tokens: { accessToken, refreshToken },
    };
  }
}
