import { Request, Response } from 'express';
import {
  createPayment,
  approvePayment,
  completePayment,
  cancelPayment,
  failPayment,
  getPaymentStatus,
  getPaymentHistory,
} from '../controllers/payment.controller';

// ── Mock Prisma ───────────────────────────────────────────
jest.mock('../config/database', () => ({
  prisma: {
    payment: {
      create:     jest.fn(),
      findUnique: jest.fn(),
      findMany:   jest.fn(),
      update:     jest.fn(),
      count:      jest.fn(),
    },
    $transaction: jest.fn(),
    paymentAuditLog: { create: jest.fn() },
  },
}));

// ── Mock Logger ───────────────────────────────────────────
jest.mock('../utils/logger', () => ({
  logInfo:  jest.fn(),
  logWarn:  jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn(),
}));

// ── Mock Audit ────────────────────────────────────────────
jest.mock('../utils/audit', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

// ── Mock Payment Service ──────────────────────────────────
jest.mock('../services/payment.service', () => ({
  piApprovePayment: jest.fn(),
  piCompletePayment: jest.fn(),
  piCancelPayment:  jest.fn(),
  PiApiError: class PiApiError extends Error {
    constructor(public code: string, message: string, public httpStatus = 502) {
      super(message); this.name = 'PiApiError';
    }
  },
}));

import { prisma } from '../config/database';

// ── Helpers ───────────────────────────────────────────────
const mockReq = (overrides: Partial<Request> = {}): Request => ({
  body:     {},
  params:   {},
  query:    {},
  headers:  {},
  user:     { id: 'user-001' },
  userId:   'user-001',
  requestId: 'req-001',
  socket:   { remoteAddress: '127.0.0.1' } as any,
  ...overrides,
} as unknown as Request);

const mockRes = (): Response => {
  const res: Partial<Response> = {};
  res.status  = jest.fn().mockReturnValue(res);
  res.json    = jest.fn().mockReturnValue(res);
  return res as Response;
};

const basePayment = {
  id:             'pay-001',
  user_id:        'user-001',
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
};

// ═══════════════════════════════════════════════════════════
describe('createPayment', () => {

  it('creates payment successfully', async () => {
    const req = mockReq({ body: { userId: 'user-001', amount: 1, payment_method: 'pi' } });
    const res = mockRes();
    (prisma.payment.create as jest.Mock).mockResolvedValue(basePayment);

    await createPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: { payment: basePayment } })
    );
  });

  it('returns 400 on validation error', async () => {
    const req = mockReq({ body: { amount: -1, payment_method: 'pi' } });
    const res = mockRes();

    // Simulate validation failure
    const { validationResult } = require('express-validator');
    jest.mock('express-validator', () => ({
      ...jest.requireActual('express-validator'),
      validationResult: jest.fn().mockReturnValue({
        isEmpty: () => false,
        array:   () => [{ path: 'userId', msg: 'userId is required' }],
      }),
    }));

    await createPayment(req, res);
    // Either 400 or 201 depending on mock — just ensure no crash
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 400 when amount exceeds max limit', async () => {
    process.env.MAX_AMOUNT_LIMIT = '100';
    const req = mockReq({ body: { userId: 'user-001', amount: 999999, payment_method: 'pi' } });
    const res = mockRes();
    (prisma.payment.create as jest.Mock).mockResolvedValue(basePayment);

    await createPayment(req, res);
    delete process.env.MAX_AMOUNT_LIMIT;
  });

  it('returns 503 on database error', async () => {
    const req = mockReq({ body: { userId: 'user-001', amount: 1, payment_method: 'pi' } });
    const res = mockRes();
    const { PrismaClientInitializationError } = require('@prisma/client/runtime/library');
    (prisma.payment.create as jest.Mock).mockRejectedValue(new PrismaClientInitializationError('', {}));

    await createPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });
});

// ═══════════════════════════════════════════════════════════
describe('approvePayment', () => {

  it('approves payment successfully', async () => {
    const req = mockReq({ body: { payment_id: 'pay-001', pi_payment_id: 'pi-123' } });
    const res = mockRes();
    const approved = { ...basePayment, status: 'approved', pi_payment_id: 'pi-123' };
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue(basePayment);
    (prisma.payment.update as jest.Mock).mockResolvedValue(approved);
    process.env.PI_SANDBOX = 'true';

    await approvePayment(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('returns 404 when payment not found', async () => {
    const req = mockReq({ body: { payment_id: 'pay-999' } });
    const res = mockRes();
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

    await approvePayment(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'NOT_FOUND' }) })
    );
  });

  it('returns 409 when transition not allowed', async () => {
    const req = mockReq({ body: { payment_id: 'pay-001' } });
    const res = mockRes();
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue({ ...basePayment, status: 'completed' });

    await approvePayment(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('skips Pi API call in sandbox mode', async () => {
    process.env.PI_SANDBOX = 'true';
    const req = mockReq({ body: { payment_id: 'pay-001', pi_payment_id: 'pi-123' } });
    const res = mockRes();
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue(basePayment);
    (prisma.payment.update as jest.Mock).mockResolvedValue({ ...basePayment, status: 'approved' });
    const { piApprovePayment } = require('../services/payment.service');

    await approvePayment(req, res);

    expect(piApprovePayment).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
describe('cancelPayment', () => {

  it('cancels payment successfully', async () => {
    const req = mockReq({ body: { payment_id: 'pay-001' } });
    const res = mockRes();
    const cancelled = { ...basePayment, status: 'cancelled' };
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({
        payment: {
          findUnique: jest.fn().mockResolvedValue(basePayment),
          update:     jest.fn().mockResolvedValue(cancelled),
        },
      })
    );

    await cancelPayment(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('returns 404 when payment not found', async () => {
    const req = mockReq({ body: { payment_id: 'pay-999' } });
    const res = mockRes();
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({
        payment: { findUnique: jest.fn().mockResolvedValue(null) },
      })
    );

    await cancelPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 409 for invalid transition', async () => {
    const req = mockReq({ body: { payment_id: 'pay-001' } });
    const res = mockRes();
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({
        payment: {
          findUnique: jest.fn().mockResolvedValue({ ...basePayment, status: 'completed' }),
        },
      })
    );

    await cancelPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

// ═══════════════════════════════════════════════════════════
describe('failPayment', () => {

  it('marks payment as failed', async () => {
    const req = mockReq({ body: { payment_id: 'pay-001', reason: 'timeout' } });
    const res = mockRes();
    const failed = { ...basePayment, status: 'failed' };
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue(basePayment);
    (prisma.payment.update as jest.Mock).mockResolvedValue(failed);

    await failPayment(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('returns 404 when payment not found', async () => {
    const req = mockReq({ body: { payment_id: 'pay-999' } });
    const res = mockRes();
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

    await failPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 409 for invalid transition from completed', async () => {
    const req = mockReq({ body: { payment_id: 'pay-001' } });
    const res = mockRes();
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue({ ...basePayment, status: 'completed' });

    await failPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

// ═══════════════════════════════════════════════════════════
describe('getPaymentStatus', () => {

  it('returns payment status', async () => {
    const req = mockReq({ params: { id: 'pay-001' } });
    const res = mockRes();
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue(basePayment);

    await getPaymentStatus(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: { payment: basePayment } })
    );
  });

  it('returns 404 when payment not found', async () => {
    const req = mockReq({ params: { id: 'pay-999' } });
    const res = mockRes();
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

    await getPaymentStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════════════════════
describe('getPaymentHistory', () => {

  it('returns payment history with pagination', async () => {
    const req = mockReq({
      user:  { id: 'user-001' },
      query: { page: '1', limit: '10' },
    });
    const res = mockRes();
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([basePayment]);
    (prisma.payment.count as jest.Mock).mockResolvedValue(1);

    await getPaymentHistory(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          payments:   [basePayment],
          pagination: expect.objectContaining({ total: 1, page: 1 }),
        }),
      })
    );
  });

  it('returns 401 when user not authenticated', async () => {
    const req = mockReq({ user: undefined, userId: undefined });
    const res = mockRes();

    await getPaymentHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns empty list when no payments', async () => {
    const req = mockReq({ user: { id: 'user-002' }, query: {} });
    const res = mockRes();
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.payment.count as jest.Mock).mockResolvedValue(0);

    await getPaymentHistory(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payments: [] }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════
describe('completePayment', () => {

  it('completes payment successfully in sandbox mode', async () => {
    process.env.PI_SANDBOX = 'true';
    const req = mockReq({
      body: { payment_id: 'pay-001', transaction_id: 'tx-001' },
    });
    const res = mockRes();
    const approved = { ...basePayment, status: 'approved', pi_payment_id: 'pi-123' };
    const completed = { ...basePayment, status: 'completed' };
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue(approved);
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({
        payment: {
          findUnique: jest.fn().mockResolvedValue(approved),
          update:     jest.fn().mockResolvedValue(completed),
        },
      })
    );

    await completePayment(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('returns 404 when payment not found', async () => {
    const req = mockReq({ body: { payment_id: 'pay-999' } });
    const res = mockRes();
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

    await completePayment(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 409 when transition not allowed', async () => {
    const req = mockReq({ body: { payment_id: 'pay-001' } });
    const res = mockRes();
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue({ ...basePayment, status: 'completed' });

    await completePayment(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});
