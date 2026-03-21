import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // GET /analytics/overview
  @Get('overview')
  async getOverview() {
    const data = await this.analyticsService.getOverview();
    return { success: true, data };
  }

  // GET /analytics/payments
  @Get('payments')
  async getPayments() {
    const data = await this.analyticsService.getPaymentAnalytics();
    return { success: true, data };
  }

  // GET /analytics/users
  @Get('users')
  async getUsers() {
    const data = await this.analyticsService.getUserAnalytics();
    return { success: true, data };
  }

  // GET /analytics/events
  @Get('events')
  async getEvents(@Query('limit') limit?: string) {
    const data = await this.analyticsService.getRecentEvents(
      limit ? parseInt(limit) : 20,
    );
    return { success: true, data };
  }
}
