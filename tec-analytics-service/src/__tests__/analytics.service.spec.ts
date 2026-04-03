import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService }    from '../modules/analytics/analytics.service';
import { PrismaService }       from '../prisma/prisma.service';

// ── Mock Data ─────────────────────────────────────────────────
const mockEvent = {
  id:         'event-uuid-1',
  type:       'payment.completed',
  payload:    { amount: 10, currency: 'PI' },
  user_id:    'user-uuid-1',
  created_at: new Date(),
};

const mockMetric = {
  id:             'metric-uuid-1',
  date:           new Date('2026-04-01'),
  total_payments: 5,
  total_volume:   50,
  new_users:      3,
  active_users:   10,
  kyc_submitted:  2,
  kyc_verified:   1,
  orders_created: 4,
  orders_volume:  40,
};

const prismaMock = {
  analyticsEvent: {
    create:   jest.fn(),
    count:    jest.fn(),
    findMany: jest.fn(),
  },
  dailyMetric: {
    upsert:   jest.fn(),
    findMany: jest.fn(),
  },
};

// ── Tests ─────────────────────────────────────────────────────
describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    jest.clearAllMocks();
  });

  // ── trackEvent ────────────────────────────────────────────────
  describe('trackEvent', () => {
    it('creates analytics event', async () => {
      prismaMock.analyticsEvent.create.mockResolvedValue(mockEvent);

      await service.trackEvent({
        type:    'payment.completed',
        payload: { amount: 10, currency: 'PI' },
        userId:  'user-uuid-1',
      });

      expect(prismaMock.analyticsEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type:    'payment.completed',
          user_id: 'user-uuid-1',
        }),
      });
    });

    it('creates event without userId', async () => {
      prismaMock.analyticsEvent.create.mockResolvedValue(mockEvent);

      await service.trackEvent({
        type:    'system.health',
        payload: { status: 'ok' },
      });

      expect(prismaMock.analyticsEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type:    'system.health',
          user_id: undefined,
        }),
      });
    });
  });

  // ── updateDailyMetric ─────────────────────────────────────────
  describe('updateDailyMetric', () => {
    it('upserts daily metric', async () => {
      prismaMock.dailyMetric.upsert.mockResolvedValue(mockMetric);

      await service.updateDailyMetric({
        date:  new Date('2026-04-01'),
        field: 'total_payments',
        value: 1,
      });

      expect(prismaMock.dailyMetric.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ total_payments: 1 }),
          update: expect.objectContaining({
            total_payments: { increment: 1 },
          }),
        }),
      );
    });

    it('normalizes date to midnight', async () => {
      prismaMock.dailyMetric.upsert.mockResolvedValue(mockMetric);

      await service.updateDailyMetric({
        date:  new Date('2026-04-01T15:30:00Z'),
        field: 'new_users',
        value: 1,
      });

      const call = prismaMock.dailyMetric.upsert.mock.calls[0][0];
      const date: Date = call.where.date;
      expect(date.getHours()).toBe(0);
      expect(date.getMinutes()).toBe(0);
      expect(date.getSeconds()).toBe(0);
    });
  });

  // ── getOverview ───────────────────────────────────────────────
  describe('getOverview', () => {
    it('returns overview data', async () => {
      prismaMock.analyticsEvent.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(20);
      prismaMock.dailyMetric.findMany.mockResolvedValue([mockMetric]);

      const result = await service.getOverview();

      expect(result.totalEvents).toBe(100);
      expect(result.totalPayments).toBe(30);
      expect(result.totalUsers).toBe(20);
      expect(result.recentMetrics).toHaveLength(1);
    });
  });

  // ── getPaymentAnalytics ───────────────────────────────────────
  describe('getPaymentAnalytics', () => {
    it('returns payment metrics with totals', async () => {
      prismaMock.dailyMetric.findMany.mockResolvedValue([
        { date: new Date(), total_payments: 5,  total_volume: 50  },
        { date: new Date(), total_payments: 10, total_volume: 100 },
      ]);

      const result = await service.getPaymentAnalytics();

      expect(result.totalCount).toBe(15);
      expect(result.totalVolume).toBe(150);
      expect(result.metrics).toHaveLength(2);
    });

    it('returns zeros when no metrics', async () => {
      prismaMock.dailyMetric.findMany.mockResolvedValue([]);

      const result = await service.getPaymentAnalytics();

      expect(result.totalCount).toBe(0);
      expect(result.totalVolume).toBe(0);
    });
  });

  // ── getUserAnalytics ──────────────────────────────────────────
  describe('getUserAnalytics', () => {
    it('returns user metrics', async () => {
      prismaMock.dailyMetric.findMany.mockResolvedValue([mockMetric]);

      const result = await service.getUserAnalytics();

      expect(result.metrics).toHaveLength(1);
      expect(prismaMock.dailyMetric.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 30 }),
      );
    });
  });

  // ── getRecentEvents ───────────────────────────────────────────
  describe('getRecentEvents', () => {
    it('returns recent events with default limit', async () => {
      prismaMock.analyticsEvent.findMany.mockResolvedValue([mockEvent]);

      const result = await service.getRecentEvents();

      expect(prismaMock.analyticsEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
      expect(result).toHaveLength(1);
    });

    it('respects custom limit', async () => {
      prismaMock.analyticsEvent.findMany.mockResolvedValue([]);

      await service.getRecentEvents(5);

      expect(prismaMock.analyticsEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });
});
