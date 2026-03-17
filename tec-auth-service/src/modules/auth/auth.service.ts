// src/modules/auth/auth.service.ts

import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { env } from '../../../config/env';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  /**
   * Register a new user
   */
  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();

    // Check if user already exists
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new ConflictException('User already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email,
        password_hash: passwordHash,
        kyc_status: 'pending',
        role: 'user',
      },
      select: {
        id: true,
        email: true,
        role: true,
        created_at: true,
      },
    });

    return user;
  }

  /**
   * Login user and return JWT
   */
  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(dto.password, user.password_hash);

    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate JWT token
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN || '1h',
    });

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }
}
