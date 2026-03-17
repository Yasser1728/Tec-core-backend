// src/modules/auth/auth.service.ts

import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { env } from '../../../config/env';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  /**
   * Register a new user (Email + optional Pi Network)
   */
  async register(dto: RegisterDto) {
    // Check if email or Pi UID already exists
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.email },
          { pi_uid: dto.pi_uid || undefined },
        ],
      },
    });

    if (existingUser) {
      throw new ConflictException('User already exists with the provided email or Pi UID');
    }

    // Hash password
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : null;

    // Create user
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

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        user_id: user.id,
        action: 'register',
        metadata: { email: dto.email, pi_uid: dto.pi_uid },
      },
    });

    return user;
  }

  /**
   * Login user with email/password or Pi Network UID
   */
  async login(dto: LoginDto) {
    // Find user by email or Pi UID
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.email },
          { pi_uid: dto.pi_uid },
        ],
      },
    });

    // Validate credentials if email/password
    if (dto.email && dto.password) {
      if (!user || !user.password_hash || !(await bcrypt.compare(dto.password, user.password_hash))) {
        await this.recordLoginAttempt(dto.email, false);
        throw new UnauthorizedException('Invalid credentials');
      }
    }

    // If Pi Network login only, check user exists
    if (dto.pi_uid && !user) {
      throw new UnauthorizedException('Pi Network user not found');
    }

    // Generate JWT
    const tokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      pi_uid: user.pi_uid,
    };
    const accessToken = jwt.sign(tokenPayload, env.JWT_SECRET, { expiresIn: '1h' });

    // Record successful login attempt
    await this.recordLoginAttempt(user.email || user.pi_uid, true);

    // Create session & refresh token
    const sessionId = uuidv4();
    const refreshToken = uuidv4();
    await this.prisma.session.create({
      data: {
        id: sessionId,
        user_id: user.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });
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

  /**
   * Record login attempts (success/failure)
   */
  private async recordLoginAttempt(identifier: string, success: boolean) {
    await this.prisma.loginAttempt.create({
      data: {
        email: identifier,
        success,
        created_at: new Date(),
      },
    });
  }
        }
