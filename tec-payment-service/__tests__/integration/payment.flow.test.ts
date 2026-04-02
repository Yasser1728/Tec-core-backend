import request from 'supertest';
import { v4 as uuid } from 'uuid';

// ── Mock everything before app import ────────────────────
const mockCreate       = jest.fn();
const mockFindUnique   = jest.fn();
const mockFindFirst    = jest.fn();
const mockUpdate       = jest.fn();
const mockCount        = jest.fn();
const mockTransaction  = jest.fn();
const mockFindMany     = jest.fn();
const mockXadd         = jest.fn();
const mockAuditCreate  = jest.fn();
const mockOutboxCreate = jest.fn();

jest.mock('../../src/config/database', () => ({
  prisma: {
    payment: {
      create:     mockCreate,
      findUnique: mockFindUnique,
      findFirst:  mockFindFirst,
      update:     mockUpdate,
      findMany:   mockFindMany,
      count:      mockCount,
    },
    paymentAuditLog: { create: mockAuditCreate },
    outboxEvent:     { create: mockOutboxCreate, findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    $transaction:    mockTransaction,
    $queryRaw:       jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../src/services/event-bus', () => ({
  createPublisher: jest.fn(() => ({
    status: 'ready',
    xadd:   mockXadd,
    on:     jest.fn(),
    once:   jest.fn(),
  })),
  publishEvent: jest.fn().mockResolvedValue('1234-0'),
  EVENTS: { PAYMENT_COMPLETED: 'payment.completed' },
}));

jest.mock('../../src/infra/observability', () => ({
  initSentry: jest.fn(),
  Sentry:     { captureException: jest.fn() },
  isSentryEnabled: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/infra/metrics', () => ({
  register: { metrics: jest.fn().mockResolvedValue(''), contentType: 'text/plain' },
}));

jest.mock('../../src/middlewares/metrics', () => ({
  metricsMiddleware: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../src/middlewares/idempotency.middleware', () => ({
  idempotency:          (_req: any, _res: any, next: any) => next(),
  initIdempotencyStore: jest.fn(),
  setIdempotencyStore:  jest.fn(),
}));

jest.mock('../../src/services/outbox.worker', () => ({
  startOutboxWorker: jest.fn(),
  stopOutboxWorker:  jest.fn(),
}));

jest.mock('../../src/utils/audit', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

// ── JWT mock — sets req.user + req.userId ─────────────────
jest.mock('../../src/middlewares/jwt.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user   = { id: '123e4567-e89b-12d3-a456-426614174000', role: 'user' };
    req.userId = '123e4567-e89b-12d3-a456-426614174000';
    next();
  },
}));

import app from '../../src/app';

// ── Helpers ───────────────────────────────────────────────
const INTERNAL_SECRET = 'test-internal-secret';
const USER_ID         = '123e4567-e89b-12d3-a456-426614174000';

const makePayment = (overrides = {}) => ({
  id:             uuid(),
  user_id:        USER_ID,
  amount:         1,
  currency:       'PI',
  payment_method: 'pi',
  status:         'created',
  pi_payment_id:  null,
  transaction_id: null,
  metadata:       {},
  created_at:     new Date(),
  updated_at:     new Date(),
  approved_at:    null,
  completed_at:   null,
  failed_at:      null,
  cancelled_at:   null,
  deleted_at:     null,
  auditLogs:      [],
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PI_SANDBOX     = 'true';
  process.env.INTERNAL_SECRET = INTERNAL_SECRET;
});

// ══════════════════════════════════════════════════════════
describe('POST /payments/create', () => {

  it('creates payment and returns 201', async () => {
    const payment = makePayment();
    mockCreate.mockResolvedValue(payment);

    const res = await request(app)
      .post('/payments/create')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ userId: USER_ID, amount: 1, currency: 'PI', payment_method: 'pi' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payment.status).toBe('created');
  });

  it('returns 400 when userId is missing', async () => {
    const res = await request(app)
      .post('/payments/create')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ amount: 1, payment_method: 'pi' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when amount is zero', async () => {
    const res = await request(app)
      .post('/payments/create')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ userId: USER_ID, amount: 0, payment_method: 'pi' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when payment_method is invalid', async () => {
    const res = await request(app)
      .post('/payments/create')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ userId: USER_ID, amount: 1, payment_method: 'bitcoin' });

    expect(res.status).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════
describe('POST /payments/approve', () => {

  it('approves a created payment', async () => {
    const paymentId = uuid();
    const payment   = makePayment({ id: paymentId });
    const approved  = makePayment({ id: paymentId, status: 'approved', pi_payment_id: 'pi-abc' });

    mockFindUnique.mockResolvedValue(payment);
    mockUpdate.mockResolvedValue(approved);

    const res = await request(app)
      .post('/payments/approve')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ payment_id: paymentId, pi_payment_id: 'pi-abc' });

    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe('approved');
  });

  it('returns 409 when payment already approved', async () => {
    const paymentId = uuid();
    mockFindUnique.mockResolvedValue(makePayment({ id: paymentId, status: 'approved' }));

    const res = await request(app)
      .post('/payments/approve')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ payment_id: paymentId });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('returns 404 when payment not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/payments/approve')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ payment_id: uuid() });

    expect(res.status).toBe(404);
  });

  it('returns 400 when payment_id is not UUID', async () => {
    const res = await request(app)
      .post('/payments/approve')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ payment_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════
describe('POST /payments/complete — Payment→Redis flow', () => {

  it('completes an approved payment and emits event', async () => {
    const paymentId = uuid();
    const approved  = makePayment({ id: paymentId, status: 'approved', pi_payment_id: 'pi-xyz' });
    const completed = makePayment({ id: paymentId, status: 'completed', pi_payment_id: 'pi-xyz', payment_method: 'pi' });

    mockFindUnique.mockResolvedValue(approved);
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      payment: {
        findUnique: jest.fn().mockResolvedValue(approved),
        update:     jest.fn().mockResolvedValue(completed),
      },
    }));

    const { publishEvent } = require('../../src/services/event-bus');

    const res = await request(app)
      .post('/payments/complete')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ payment_id: paymentId, transaction_id: 'tx-abc12345' });

    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe('completed');

    // Allow async event emission
    await new Promise(r => setTimeout(r, 100));
    expect(publishEvent).toHaveBeenCalledWith(
      expect.any(Object),
      'payment.completed',
      expect.objectContaining({ paymentId, userId: USER_ID }),
    );
  });

  it('returns 409 when payment is already completed', async () => {
    const paymentId = uuid();
    mockFindUnique.mockResolvedValue(makePayment({ id: paymentId, status: 'completed' }));

    const res = await request(app)
      .post('/payments/complete')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ payment_id: paymentId });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('returns 404 when payment not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/payments/complete')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ payment_id: uuid() });

    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════
describe('POST /payments/cancel', () => {

  it('cancels a created payment', async () => {
    const paymentId = uuid();
    const cancelled = makePayment({ id: paymentId, status: 'cancelled' });

    mockTransaction.mockImplementation(async (fn: Function) => fn({
      payment: {
        findUnique: jest.fn().mockResolvedValue(makePayment({ id: paymentId, status: 'created' })),
        update:     jest.fn().mockResolvedValue(cancelled),
      },
    }));

    const res = await request(app)
      .post('/payments/cancel')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ payment_id: paymentId });

    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe('cancelled');
  });

  it('returns 409 when payment already completed', async () => {
    const paymentId = uuid();
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      payment: {
        findUnique: jest.fn().mockResolvedValue(makePayment({ id: paymentId, status: 'completed' })),
        update:     jest.fn(),
      },
    }));

    const res = await request(app)
      .post('/payments/cancel')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ payment_id: paymentId });

    expect(res.status).toBe(409);
  });
});

// ══════════════════════════════════════════════════════════
describe('GET /payments/:id/status', () => {

  it('returns payment status', async () => {
    const paymentId = uuid();
    mockFindUnique.mockResolvedValue(makePayment({ id: paymentId, status: 'approved' }));

    const res = await request(app)
      .get(`/payments/${paymentId}/status`)
      .set('x-internal-key', INTERNAL_SECRET);

    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe('approved');
  });

  it('returns 404 when payment not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .get(`/payments/${uuid()}/status`)
      .set('x-internal-key', INTERNAL_SECRET);

    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════
describe('GET /payments/history', () => {

  it('returns payment history for authenticated user', async () => {
    mockFindMany.mockResolvedValue([makePayment({ status: 'completed' })]);
    mockCount.mockResolvedValue(1);

    const res = await request(app)
      .get('/payments/history')
      .set('x-internal-key', INTERNAL_SECRET);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payments).toHaveLength(1);
    expect(res.body.data.pagination.total).toBe(1);
  });

  it('supports pagination params', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const res = await request(app)
      .get('/payments/history?page=2&limit=5')
      .set('x-internal-key', INTERNAL_SECRET);

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.page).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════
describe('GET /health', () => {

  it('returns 200 with service info', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('payment-service');
  });
});

// ══════════════════════════════════════════════════════════
describe('Payment State Machine', () => {

  it('created → approved → completed is valid flow', async () => {
    const paymentId = uuid();

    // Step 1: Create
    mockCreate.mockResolvedValue(makePayment({ id: paymentId }));
    const create = await request(app)
      .post('/payments/create')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ userId: USER_ID, amount: 1, payment_method: 'pi' });
    expect(create.status).toBe(201);

    // Step 2: Approve
    mockFindUnique.mockResolvedValue(makePayment({ id: paymentId }));
    mockUpdate.mockResolvedValue(makePayment({ id: paymentId, status: 'approved' }));
    const approve = await request(app)
      .post('/payments/approve')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ payment_id: paymentId, pi_payment_id: 'pi-test' });
    expect(approve.status).toBe(200);
    expect(approve.body.data.payment.status).toBe('approved');

    // Step 3: Complete
    const approvedPayment = makePayment({ id: paymentId, status: 'approved', pi_payment_id: 'pi-test' });
    const completedPayment = makePayment({ id: paymentId, status: 'completed', payment_method: 'pi' });
    mockFindUnique.mockResolvedValue(approvedPayment);
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      payment: {
        findUnique: jest.fn().mockResolvedValue(approvedPayment),
        update:     jest.fn().mockResolvedValue(completedPayment),
      },
    }));

    const complete = await request(app)
      .post('/payments/complete')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ payment_id: paymentId, transaction_id: 'tx-abc12345' });
    expect(complete.status).toBe(200);
    expect(complete.body.data.payment.status).toBe('completed');
  });

  it('cannot cancel a completed payment', async () => {
    const paymentId = uuid();
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      payment: {
        findUnique: jest.fn().mockResolvedValue(makePayment({ id: paymentId, status: 'completed' })),
        update:     jest.fn(),
      },
    }));

    const res = await request(app)
      .post('/payments/cancel')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Idempotency-Key', uuid())
      .send({ payment_id: paymentId });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });
});
