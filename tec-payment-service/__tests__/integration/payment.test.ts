/**
 * Integration tests for the Phase 3 payment service.
 *
 * The Prisma client and the idempotency store are mocked so these tests run
 * without a live database.
 */
import request from 'supertest';
import express, { Application } from 'express';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

// We mock the generated client path used by the controller.
const mockTransaction = jest.fn();
const mockPaymentFindUnique = jest.fn();

jest.mock('../../prisma/client', () => ({
  PaymentStatus: {
    PENDING:   'PENDING',
    CONFIRMED: 'CONFIRMED',
    FAILED:    'FAILED',
    CANCELLED: 'CANCELLED',
  },
  AuditEventType: {
    PAYMENT_INITIATED:  'PAYMENT_INITIATED',
    PAYMENT_CONFIRMED:  'PAYMENT_CONFIRMED',
    PAYMENT_CANCELLED:  'PAYMENT_CANCELLED',
    PAYMENT_FAILED:     'PAYMENT_FAILED',
    INVALID_TRANSITION: 'INVALID_TRANSITION',
  },
}));

jest.mock('../../src/config/database', () => ({
  prisma: {
    $transaction: mockTransaction,
    payment: {
      findUnique: mockPaymentFindUnique,
    },
  },
}));

// ─── Import controllers after mocks ──────────────────────────────────────────

import {
  initiatePayment,
  confirmPayment,
  cancelPayment,
  getPaymentStatus,
} from '../../src/controllers/payment.controller';

// ─── Test app (bypasses JWT / idempotency for unit-level controller tests) ────

/**
 * Build a minimal Express app that sets `req.user` directly so we can test
 * controller logic without a real JWT.
 */
function makeApp(userId = '11111111-1111-1111-1111-111111111111'): Application {
  const app = express();
  app.use(express.json());

  // Simulate what the JWT middleware would attach.
  app.use((req, _res, next) => {
    (req as any).user = { id: userId, role: 'user', sessionId: 'sess-1' };
    next();
  });

  app.post('/payments/initiate', initiatePayment);
  app.post('/payments/confirm',  confirmPayment);
  app.post('/payments/cancel',   cancelPayment);
  app.get('/payments/:id/status', getPaymentStatus);

  return app;
}

// Stable UUIDs used across tests
const USER_ID    = '11111111-1111-1111-1111-111111111111';
const PAYMENT_ID = '22222222-2222-2222-2222-222222222222';

// ─── initiatePayment ──────────────────────────────────────────────────────────

describe('POST /payments/initiate', () => {
  const app = makeApp();

  const validBody = {
    amount:         '10.50',
    currency:       'USD',
    idempotencyKey: 'idem-key-001',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a PENDING payment and returns 201', async () => {
    const now = new Date();
    mockTransaction.mockImplementation(async (fn: Function) =>
      fn({
        payment: {
          create: jest.fn().mockResolvedValue({
            id:             PAYMENT_ID,
            userId:         USER_ID,
            amount:         { toString: () => '10.50' },
            currency:       'USD',
            status:         'PENDING',
            idempotencyKey: validBody.idempotencyKey,
            createdAt:      now,
            updatedAt:      now,
          }),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      })
    );

    const res = await request(app).post('/payments/initiate').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payment.status).toBe('PENDING');
    expect(res.body.data.payment.amount).toBe('10.50');
  });

  it('returns 422 for missing amount', async () => {
    const res = await request(app)
      .post('/payments/initiate')
      .send({ currency: 'USD', idempotencyKey: 'k1' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 for zero amount', async () => {
    const res = await request(app)
      .post('/payments/initiate')
      .send({ ...validBody, amount: '0' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 for lowercase currency', async () => {
    const res = await request(app)
      .post('/payments/initiate')
      .send({ ...validBody, currency: 'usd' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 for missing idempotencyKey', async () => {
    const res = await request(app)
      .post('/payments/initiate')
      .send({ amount: '10', currency: 'USD' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 on duplicate idempotency key (P2002)', async () => {
    const err: any = new Error('Unique constraint');
    err.code = 'P2002';
    mockTransaction.mockRejectedValue(err);

    const res = await request(app).post('/payments/initiate').send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_IDEMPOTENCY_KEY');
  });

  it('stores amount as string (no float arithmetic)', async () => {
    const now = new Date();
    let capturedAmount: unknown;
    mockTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        payment: {
          create: jest.fn().mockImplementation(async ({ data }: any) => {
            capturedAmount = data.amount;
            return {
              id: PAYMENT_ID, userId: USER_ID,
              amount: { toString: () => String(data.amount) },
              currency: 'USD', status: 'PENDING',
              idempotencyKey: validBody.idempotencyKey,
              createdAt: now, updatedAt: now,
            };
          }),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    await request(app).post('/payments/initiate').send({ ...validBody, amount: '0.1' });

    // The amount passed to Prisma must NOT be a JS float; it is a Decimal object.
    expect(typeof capturedAmount).not.toBe('number');
  });
});

// ─── confirmPayment ───────────────────────────────────────────────────────────

describe('POST /payments/confirm', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validBody = { paymentId: PAYMENT_ID };

  it('confirms a PENDING payment and returns 200', async () => {
    const now = new Date();
    mockTransaction.mockImplementation(async (fn: Function) =>
      fn({
        payment: {
          findUnique: jest.fn().mockResolvedValue({
            id: PAYMENT_ID, userId: USER_ID,
            amount: { toString: () => '10.50' },
            currency: 'USD', status: 'PENDING',
            idempotencyKey: 'k', createdAt: now, updatedAt: now,
          }),
          update: jest.fn().mockResolvedValue({
            id: PAYMENT_ID, userId: USER_ID,
            amount: { toString: () => '10.50' },
            currency: 'USD', status: 'CONFIRMED',
            idempotencyKey: 'k', createdAt: now, updatedAt: now,
          }),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      })
    );

    const res = await request(app).post('/payments/confirm').send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe('CONFIRMED');
  });

  it('returns 409 for invalid transition (CONFIRMED → CONFIRMED)', async () => {
    const now = new Date();
    mockTransaction.mockImplementation(async (fn: Function) =>
      fn({
        payment: {
          findUnique: jest.fn().mockResolvedValue({
            id: PAYMENT_ID, userId: USER_ID,
            amount: { toString: () => '10.50' },
            currency: 'USD', status: 'CONFIRMED',
            idempotencyKey: 'k', createdAt: now, updatedAt: now,
          }),
          update: jest.fn(),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      })
    );

    const res = await request(app).post('/payments/confirm').send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('returns 404 when payment not found', async () => {
    mockTransaction.mockImplementation(async (fn: Function) =>
      fn({
        payment: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      })
    );

    const res = await request(app).post('/payments/confirm').send(validBody);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 422 for invalid paymentId', async () => {
    const res = await request(app).post('/payments/confirm').send({ paymentId: 'not-a-uuid' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does NOT modify the amount during confirmation', async () => {
    const now = new Date();
    const updateMock = jest.fn().mockResolvedValue({
      id: PAYMENT_ID, userId: USER_ID,
      amount: { toString: () => '10.50' },
      currency: 'USD', status: 'CONFIRMED',
      idempotencyKey: 'k', createdAt: now, updatedAt: now,
    });

    mockTransaction.mockImplementation(async (fn: Function) =>
      fn({
        payment: {
          findUnique: jest.fn().mockResolvedValue({
            id: PAYMENT_ID, userId: USER_ID,
            amount: { toString: () => '10.50' },
            currency: 'USD', status: 'PENDING',
            idempotencyKey: 'k', createdAt: now, updatedAt: now,
          }),
          update: updateMock,
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      })
    );

    await request(app).post('/payments/confirm').send(validBody);

    // The update call must not include an `amount` field.
    const updateArgs = updateMock.mock.calls[0][0];
    expect(updateArgs.data).not.toHaveProperty('amount');
  });
});

// ─── cancelPayment ────────────────────────────────────────────────────────────

describe('POST /payments/cancel', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validBody = { paymentId: PAYMENT_ID };

  it.each(['PENDING', 'CONFIRMED'] as const)(
    'cancels a %s payment and returns 200',
    async (status) => {
      const now = new Date();
      mockTransaction.mockImplementation(async (fn: Function) =>
        fn({
          payment: {
            findUnique: jest.fn().mockResolvedValue({
              id: PAYMENT_ID, userId: USER_ID,
              amount: { toString: () => '10.50' },
              currency: 'USD', status,
              idempotencyKey: 'k', createdAt: now, updatedAt: now,
            }),
            update: jest.fn().mockResolvedValue({
              id: PAYMENT_ID, userId: USER_ID,
              amount: { toString: () => '10.50' },
              currency: 'USD', status: 'CANCELLED',
              idempotencyKey: 'k', createdAt: now, updatedAt: now,
            }),
          },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        })
      );

      const res = await request(app).post('/payments/cancel').send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.data.payment.status).toBe('CANCELLED');
    }
  );

  it('returns 409 when cancelling an already CANCELLED payment', async () => {
    const now = new Date();
    mockTransaction.mockImplementation(async (fn: Function) =>
      fn({
        payment: {
          findUnique: jest.fn().mockResolvedValue({
            id: PAYMENT_ID, userId: USER_ID,
            amount: { toString: () => '10.50' },
            currency: 'USD', status: 'CANCELLED',
            idempotencyKey: 'k', createdAt: now, updatedAt: now,
          }),
          update: jest.fn(),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      })
    );

    const res = await request(app).post('/payments/cancel').send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('returns 404 when payment not found', async () => {
    mockTransaction.mockImplementation(async (fn: Function) =>
      fn({
        payment: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      })
    );

    const res = await request(app).post('/payments/cancel').send(validBody);

    expect(res.status).toBe(404);
  });

  it('returns 422 for invalid paymentId', async () => {
    const res = await request(app).post('/payments/cancel').send({ paymentId: 'bad' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── getPaymentStatus ─────────────────────────────────────────────────────────

describe('GET /payments/:id/status', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the payment status for the owning user', async () => {
    const now = new Date();
    mockPaymentFindUnique.mockResolvedValue({
      id: PAYMENT_ID, userId: USER_ID,
      amount: { toString: () => '10.50' },
      currency: 'USD', status: 'CONFIRMED',
      idempotencyKey: 'k', createdAt: now, updatedAt: now,
    });

    const res = await request(app).get(`/payments/${PAYMENT_ID}/status`);

    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe('CONFIRMED');
    expect(res.body.data.payment.amount).toBe('10.50');
  });

  it('returns 404 when payment not found', async () => {
    mockPaymentFindUnique.mockResolvedValue(null);

    const res = await request(app).get(`/payments/${PAYMENT_ID}/status`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 when a different user requests the payment', async () => {
    const now = new Date();
    mockPaymentFindUnique.mockResolvedValue({
      id: PAYMENT_ID, userId: 'other-user-id',
      amount: { toString: () => '10.50' },
      currency: 'USD', status: 'PENDING',
      idempotencyKey: 'k', createdAt: now, updatedAt: now,
    });

    const res = await request(app).get(`/payments/${PAYMENT_ID}/status`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 422 for invalid UUID', async () => {
    const res = await request(app).get('/payments/not-a-uuid/status');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
