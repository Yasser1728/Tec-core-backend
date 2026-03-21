import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ✅ سجّل event
  async trackEvent(data: {
    type: string;
    payload: Record<string, unknown>;
    userId?: string;
  }) {
    await this.prisma.analyticsEvent.create({
      data: {
        type: data.type,
        payload: data.payload as any,
        user_id: data.userId,
      },
    });
  }

  // ✅ حدّث الـ daily metrics
  async updateDailyMetric(data: {
    date: Date;
    field: keyof {
      total_payments: number;
      total_volume: number;
      new_users: number;
      active_users: number;
      kyc_submitted: number;
      kyc_verified: number;
      orders_created: number;
      orders_volume: number;
    };
    value: number;
  }) {
    const dateOnly = new Date(data.date);
    dateOnly.setHours(0, 0, 0, 0);

    await this.prisma.dailyMetric.upsert({
      where: { date: dateOnly },
      create: {
        date: dateOnly,
        [data.field]: data.value,
      },
      update: {
        [data.field]: { increment: data.value },
      },
    });
  }

  // ✅ Overview
  async getOverview() {
    const [
      totalEvents,
      totalPayments,
      totalUsers,
      recentMetrics,
    ] = await Promise.all([
      this.prisma.analyticsEvent.count(),
      this.prisma.analyticsEvent.count({ where: { type: 'payment.completed' } }),
      this.prisma.analyticsEvent.count({ where: { type: 'user.created' } }),
      this.prisma.dailyMetric.findMany({
        orderBy: { date: 'desc' },
        take: 7,
      }),
    ]);

    return {
      totalEvents,
      totalPayments,
      totalUsers,
      recentMetrics,
    };
  }

  // ✅ Payment analytics
  async getPaymentAnalytics() {
    const metrics = await this.prisma.dailyMetric.findMany({
      orderBy: { date: 'desc' },
      take: 30,
      select: {
        date: true,
        total_payments: true,
        total_volume: true,
      },
    });

    const totalVolume = metrics.reduce((sum, m) => sum + m.total_volume, 0);
    const totalCount = metrics.reduce((sum, m) => sum + m.total_payments, 0);

    return { metrics, totalVolume, totalCount };
  }

  // ✅ User analytics
  async getUserAnalytics() {
    const metrics = await this.prisma.dailyMetric.findMany({
      orderBy: { date: 'desc' },
      take: 30,
      select: {
        date: true,
        new_users: true,
        active_users: true,
        kyc_submitted: true,
        kyc_verified: true,
      },
    });

    return { metrics };
  }

  // ✅ Recent events
  async getRecentEvents(limit = 20) {
    return this.prisma.analyticsEvent.findMany({
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }
}
