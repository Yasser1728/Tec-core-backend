import { timingSafeEqual } from 'crypto';
import {
  Controller,
  Get,
  Query,
  UseGuards,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService }       from '@nestjs/jwt';
import { AnalyticsService } from './analytics.service';

// ── Internal or JWT auth guard ────────────────────────────
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly jwtService:       JwtService,
  ) {}

  private authorize(authorization?: string, internalKey?: string): void {
    const secret = process.env.INTERNAL_SECRET;
    if (
      secret &&
      typeof internalKey === 'string' &&
      internalKey.length === secret.length &&
      timingSafeEqual(Buffer.from(internalKey), Buffer.from(secret))
    ) return;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication required');
    }
    const token = authorization.replace('Bearer ', '');
    try {
      this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  @Get('overview')
  async getOverview(
    @Headers('authorization')  authorization?: string,
    @Headers('x-internal-key') internalKey?:   string,
  ) {
    this.authorize(authorization, internalKey);
    const data = await this.analyticsService.getOverview();
    return { success: true, data };
  }

  @Get('payments')
  async getPayments(
    @Headers('authorization')  authorization?: string,
    @Headers('x-internal-key') internalKey?:   string,
  ) {
    this.authorize(authorization, internalKey);
    const data = await this.analyticsService.getPaymentAnalytics();
    return { success: true, data };
  }

  @Get('users')
  async getUsers(
    @Headers('authorization')  authorization?: string,
    @Headers('x-internal-key') internalKey?:   string,
  ) {
    this.authorize(authorization, internalKey);
    const data = await this.analyticsService.getUserAnalytics();
    return { success: true, data };
  }

  @Get('events')
  async getEvents(
    @Headers('authorization')  authorization?: string,
    @Headers('x-internal-key') internalKey?:   string,
    @Query('limit')            limit?:         string,
  ) {
    this.authorize(authorization, internalKey);
    const data = await this.analyticsService.getRecentEvents(
      limit ? parseInt(limit) : 20,
    );
    return { success: true, data };
  }
}
