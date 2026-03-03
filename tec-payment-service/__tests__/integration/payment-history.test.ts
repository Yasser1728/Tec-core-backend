import request from 'supertest';
import express from 'express';
import { query } from 'express-validator';

// Mock the database module — factory must not reference outer variables due to jest.mock hoisting
jest.mock('../../src/config/database', () => ({
  prisma: {
    payment: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

import { getPaymentHistory } from '../../src/controllers/payment.controller';
import { prisma } from '../../src/config/database';

const mockPaymentFindMany = prisma.payment.findMany as jest.MockedFunction<typeof prisma.payment.findMany>;
const mockPaymentCount = prisma.payment.count as jest.MockedFunction<typeof prisma.payment.count>;

// Test app setup
const app = express();
app.use(express.json());

// Simulate authenticate middleware — inject user
app.use((req, _res, next) => {
  (req as any).user = { id: 'user-uuid-1234-5678-9012-abcdef012345' };
  next();
});

app.get(
  '/payments/history',
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('status')
      .optional()
      .isIn(['created', 'approved', 'completed', 'cancelled', 'failed']),
    query('payment_method').optional().isIn(['pi', 'card', 'wallet']),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('sort').optional().isIn(['asc', 'desc']),
  ],
  getPaymentHistory
);

// Test app without user (unauthenticated)
const unauthApp = express();
unauthApp.use(express.json());
unauthApp.get('/payments/history', getPaymentHistory);

const mockPayment = {
  id: 'pay-uuid-1234-5678-9012-abcdef012345',
  amount: 10.5,
  currency: 'PI',
  payment_method: 'pi',
  status: 'completed',
  pi_payment_id: 'pi-txn-001',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T01:00:00Z'),
  approved_at: new Date('2026-01-01T00:30:00Z'),
  completed_at: new Date('2026-01-01T01:00:00Z'),
  failed_at: null,
  cancelled_at: null,
};

describe('GET /payments/history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return paginated results', async () => {
    mockPaymentFindMany.mockResolvedValue([mockPayment] as any);
    mockPaymentCount.mockResolvedValue(1);

    const response = await request(app).get('/payments/history');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.payments).toHaveLength(1);
    expect(response.body.data.pagination).toMatchObject({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  });

  it('should return empty array when no payments exist', async () => {
    mockPaymentFindMany.mockResolvedValue([]);
    mockPaymentCount.mockResolvedValue(0);

    const response = await request(app).get('/payments/history');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.payments).toHaveLength(0);
    expect(response.body.data.pagination.total).toBe(0);
    expect(response.body.data.pagination.totalPages).toBe(0);
  });

  it('should filter by status', async () => {
    mockPaymentFindMany.mockResolvedValue([mockPayment] as any);
    mockPaymentCount.mockResolvedValue(1);

    const response = await request(app).get('/payments/history?status=completed');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockPaymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'completed' }),
      })
    );
  });

  it('should filter by date range', async () => {
    mockPaymentFindMany.mockResolvedValue([mockPayment] as any);
    mockPaymentCount.mockResolvedValue(1);

    const response = await request(app).get(
      '/payments/history?from=2026-01-01T00:00:00Z&to=2026-01-31T23:59:59Z'
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockPaymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          created_at: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      })
    );
  });

  it('should apply pagination parameters', async () => {
    mockPaymentFindMany.mockResolvedValue([mockPayment] as any);
    mockPaymentCount.mockResolvedValue(50);

    const response = await request(app).get('/payments/history?page=2&limit=10');

    expect(response.status).toBe(200);
    expect(response.body.data.pagination).toMatchObject({
      page: 2,
      limit: 10,
      total: 50,
      totalPages: 5,
      hasNext: true,
      hasPrev: true,
    });
    expect(mockPaymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    );
  });

  it('should return 400 for invalid status filter', async () => {
    const response = await request(app).get('/payments/history?status=invalid');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 401 when not authenticated', async () => {
    const response = await request(unauthApp).get('/payments/history');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});
