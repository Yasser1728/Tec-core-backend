import request from 'supertest';
import express from 'express';

// Mock prisma client
const mockPrismaClient = {
  payment: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  prisma: mockPrismaClient,
}));

// Mock audit utility so we don't need a real DB for audit logs
jest.mock('../../src/utils/audit', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

// Import controller after mocks
import { handleIncompletePayment } from '../../src/controllers/webhook.controller';

const PI_API_KEY = 'test-pi-api-key';

const app = express();
app.use(express.json());
app.post('/payments/webhook/incomplete', handleIncompletePayment);

const validPayload = {
  payment: {
    identifier: 'pi_payment_123',
    amount: 1.0,
    memo: 'test',
    status: {
      developer_approved: true,
      transaction_verified: true,
      developer_completed: false,
    },
    transaction: { txid: 'tx_abc123' },
  },
};

describe('POST /payments/webhook/incomplete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PI_API_KEY = PI_API_KEY;
    // Mock global fetch so Pi API calls succeed
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue('{}'),
      json: jest.fn().mockResolvedValue({}),
    } as unknown as Response);
  });

  // ─── Auth ───────────────────────────────────────────────────────────────────

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app)
      .post('/payments/webhook/incomplete')
      .send(validPayload);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when Authorization header has wrong key', async () => {
    const res = await request(app)
      .post('/payments/webhook/incomplete')
      .set('Authorization', 'Key wrong-key')
      .send(validPayload);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 200 when authorized via Authorization header', async () => {
    const mockPayment = {
      id: 'uuid-1',
      user_id: 'user-uuid',
      status: 'approved',
      pi_payment_id: 'pi_payment_123',
    };
    mockPrismaClient.payment.findFirst.mockResolvedValue(mockPayment);
    mockPrismaClient.payment.update.mockResolvedValue({ ...mockPayment, status: 'completed' });

    const res = await request(app)
      .post('/payments/webhook/incomplete')
      .set('Authorization', `Key ${PI_API_KEY}`)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 200 when authorized via x-pi-key header (bare key value)', async () => {
    const mockPayment = {
      id: 'uuid-1',
      user_id: 'user-uuid',
      status: 'approved',
      pi_payment_id: 'pi_payment_123',
    };
    mockPrismaClient.payment.findFirst.mockResolvedValue(mockPayment);
    mockPrismaClient.payment.update.mockResolvedValue({ ...mockPayment, status: 'completed' });

    const res = await request(app)
      .post('/payments/webhook/incomplete')
      .set('x-pi-key', PI_API_KEY)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ─── Validation ─────────────────────────────────────────────────────────────

  it('returns 400 when payment.identifier is missing', async () => {
    const res = await request(app)
      .post('/payments/webhook/incomplete')
      .set('Authorization', `Key ${PI_API_KEY}`)
      .send({ payment: {} });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // ─── Payment not found ───────────────────────────────────────────────────────

  it('returns 200 (idempotent) when payment is not found', async () => {
    mockPrismaClient.payment.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/payments/webhook/incomplete')
      .set('Authorization', `Key ${PI_API_KEY}`)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPrismaClient.payment.update).not.toHaveBeenCalled();
  });

  // ─── Idempotency ─────────────────────────────────────────────────────────────

  it('returns 200 without action when payment is already completed', async () => {
    mockPrismaClient.payment.findFirst.mockResolvedValue({
      id: 'uuid-1',
      user_id: 'user-uuid',
      status: 'completed',
      pi_payment_id: 'pi_payment_123',
    });

    const res = await request(app)
      .post('/payments/webhook/incomplete')
      .set('Authorization', `Key ${PI_API_KEY}`)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPrismaClient.payment.update).not.toHaveBeenCalled();
  });

  it('returns 200 without action when payment is already cancelled', async () => {
    mockPrismaClient.payment.findFirst.mockResolvedValue({
      id: 'uuid-1',
      user_id: 'user-uuid',
      status: 'cancelled',
      pi_payment_id: 'pi_payment_123',
    });

    const res = await request(app)
      .post('/payments/webhook/incomplete')
      .set('Authorization', `Key ${PI_API_KEY}`)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPrismaClient.payment.update).not.toHaveBeenCalled();
  });

  // ─── Happy path ──────────────────────────────────────────────────────────────

  it('completes an approved payment and updates DB', async () => {
    const mockPayment = {
      id: 'uuid-1',
      user_id: 'user-uuid',
      status: 'approved',
      pi_payment_id: 'pi_payment_123',
    };
    const updatedPayment = { ...mockPayment, status: 'completed', completed_at: new Date() };
    mockPrismaClient.payment.findFirst.mockResolvedValue(mockPayment);
    mockPrismaClient.payment.update.mockResolvedValue(updatedPayment);

    const res = await request(app)
      .post('/payments/webhook/incomplete')
      .set('Authorization', `Key ${PI_API_KEY}`)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPrismaClient.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'uuid-1' },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  // ─── Pi API failure ──────────────────────────────────────────────────────────

  it('marks payment as failed when Pi API complete call fails', async () => {
    const mockPayment = {
      id: 'uuid-1',
      user_id: 'user-uuid',
      status: 'approved',
      pi_payment_id: 'pi_payment_123',
    };
    mockPrismaClient.payment.findFirst.mockResolvedValue(mockPayment);
    mockPrismaClient.payment.update.mockResolvedValue({ ...mockPayment, status: 'failed' });

    // Simulate Pi API returning a non-200 response
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 422,
      text: jest.fn().mockResolvedValue('unprocessable'),
    } as unknown as Response);

    const res = await request(app)
      .post('/payments/webhook/incomplete')
      .set('Authorization', `Key ${PI_API_KEY}`)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPrismaClient.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'uuid-1' },
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });
});
