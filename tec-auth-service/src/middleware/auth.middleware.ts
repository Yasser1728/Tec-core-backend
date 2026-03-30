import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly redis: Redis | null = null;

  constructor(private readonly jwtService: JwtService) {
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue:   false,
        lazyConnect:          true,
      });
    }
  }

  async use(req: Request, _res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer '))
      throw new UnauthorizedException('Missing token');

    const token = authHeader.split(' ')[1];

    try {
      // ── Check blacklist ──────────────────────────────────
      if (this.redis) {
        const blacklisted = await this.redis.get(`blacklist:${token}`);
        if (blacklisted) throw new UnauthorizedException('Token has been revoked');
      }

      const payload  = this.jwtService.verify(token);
      req['user']    = payload;
      next();
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid token');
    }
  }
}
