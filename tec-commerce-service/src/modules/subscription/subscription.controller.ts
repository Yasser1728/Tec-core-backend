import {
  Controller, Get, Post, Patch,
  Body, Query, Headers,
  HttpCode, HttpStatus,
  BadRequestException, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SubscriptionService } from './subscription.service';
import { SubscriptionPlan } from '../../../prisma/client';

@Controller('commerce/subscriptions')
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly jwtService:          JwtService,
  ) {}

  private getUserId(authorization?: string): string {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    try {
      const decoded = this.jwtService.verify(
        authorization.replace('Bearer ', ''),
      ) as any;
      return decoded.sub ?? decoded.id;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  // GET /commerce/subscriptions/plans
  @Get('plans')
  getPlans() {
    return {
      success: true,
      data:    { plans: this.subscriptionService.getPlans() },
    };
  }

  // GET /commerce/subscriptions/status
  @Get('status')
  async getStatus(@Headers('authorization') auth: string) {
    const userId = this.getUserId(auth);
    const sub    = await this.subscriptionService.getSubscription(userId);
    return { success: true, data: { subscription: sub } };
  }

  // POST /commerce/subscriptions/subscribe
  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  async subscribe(
    @Headers('authorization') auth: string,
    @Body() body: {
      plan:          SubscriptionPlan;
      paymentId?:    string;
      piPaymentId?:  string;
    },
  ) {
    if (!body.plan) throw new BadRequestException('plan required');
    const userId = this.getUserId(auth);
    const sub    = await this.subscriptionService.subscribe({
      userId:      userId,
      plan:        body.plan,
      paymentId:   body.paymentId,
      piPaymentId: body.piPaymentId,
    });
    return { success: true, data: { subscription: sub } };
  }

  // PATCH /commerce/subscriptions/cancel
  @Patch('cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Headers('authorization') auth: string,
    @Body('reason') reason?: string,
  ) {
    const userId = this.getUserId(auth);
    const sub    = await this.subscriptionService.cancel(userId, reason);
    return { success: true, data: { subscription: sub } };
  }

  // GET /commerce/subscriptions/access?feature=analytics
  @Get('access')
  async checkAccess(
    @Headers('authorization') auth: string,
    @Query('feature')         feature: string,
  ) {
    if (!feature) throw new BadRequestException('feature required');
    const userId   = this.getUserId(auth);
    const hasAccess = await this.subscriptionService.hasAccess(userId, feature);
    return { success: true, data: { hasAccess, feature } };
  }
}
