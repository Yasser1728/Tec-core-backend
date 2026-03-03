// Mock the database module — factory must not reference outer variables due to jest.mock hoisting
jest.mock('../../src/config/database', () => ({
  prisma: {
    payment: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    paymentAuditLog: {
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

import { reconcileStalePayments } from '../../src/services/reconciliation.service';
import { prisma } from '../../src/config/database';

const mockPaymentFindMany = prisma.payment.findMany as jest.MockedFunction<typeof prisma.payment.findMany>;
const mockPaymentUpdate = prisma.payment.update as jest.MockedFunction<typeof prisma.payment.update>;
const mockAuditLogCreate = (prisma as any).paymentAuditLog.create as jest.MockedFunction<() => Promise<unknown>>;

const makePayment = (overrides: Partial<{ id: string; status: string; user_id: string }> = {}) => ({
  id: 'pay-uuid-1234-5678-9012-abcdef000001',
  status: 'created',
  user_id: 'user-uuid-1234-5678-9012-abcdef000001',
  ...overrides,
});

describe('reconcileStalePayments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuditLogCreate.mockResolvedValue({});
  });

  it('should mark stale created payments as failed', async () => {
    const stalePayment = makePayment({ status: 'created' });
    mockPaymentFindMany.mockResolvedValue([stalePayment] as any);
    mockPaymentUpdate.mockResolvedValue({ ...stalePayment, status: 'failed' } as any);

    const result = await reconcileStalePayments();

    expect(result.reconciledCount).toBe(1);
    expect(result.details[0].originalStatus).toBe('created');
    expect(result.details[0].id).toBe(stalePayment.id);
    expect(mockPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: stalePayment.id },
        data: expect.objectContaining({
          status: 'failed',
          failed_at: expect.any(Date),
          metadata: expect.objectContaining({
            reconciled: true,
            original_status: 'created',
            reason: 'Stale payment auto-reconciled',
          }),
        }),
      })
    );
  });

  it('should mark stale approved payments as failed', async () => {
    const stalePayment = makePayment({ status: 'approved' });
    mockPaymentFindMany.mockResolvedValue([stalePayment] as any);
    mockPaymentUpdate.mockResolvedValue({ ...stalePayment, status: 'failed' } as any);

    const result = await reconcileStalePayments();

    expect(result.reconciledCount).toBe(1);
    expect(result.details[0].originalStatus).toBe('approved');
    expect(mockPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('should return zero count when no stale payments exist', async () => {
    mockPaymentFindMany.mockResolvedValue([]);

    const result = await reconcileStalePayments();

    expect(result.reconciledCount).toBe(0);
    expect(result.details).toHaveLength(0);
    expect(mockPaymentUpdate).not.toHaveBeenCalled();
  });

  it('should not touch completed, cancelled, or failed payments', async () => {
    // The query only fetches 'created' or 'approved' stale payments.
    mockPaymentFindMany.mockResolvedValue([]);

    await reconcileStalePayments();

    expect(mockPaymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ status: 'created' }),
            expect.objectContaining({ status: 'approved' }),
          ]),
        }),
      })
    );
  });

  it('should create audit logs for reconciled payments', async () => {
    const stalePayment = makePayment({ status: 'created' });
    mockPaymentFindMany.mockResolvedValue([stalePayment] as any);
    mockPaymentUpdate.mockResolvedValue({ ...stalePayment, status: 'failed' } as any);

    await reconcileStalePayments();

    // Allow the void audit log promise to resolve
    await new Promise((r) => setImmediate(r));

    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'PAYMENT_RECONCILED',
          paymentId: stalePayment.id,
          userId: stalePayment.user_id,
        }),
      })
    );
  });

  it('should handle multiple stale payments', async () => {
    const stalePayments = [
      makePayment({ id: 'pay-001', status: 'created' }),
      makePayment({ id: 'pay-002', status: 'approved' }),
    ];
    mockPaymentFindMany.mockResolvedValue(stalePayments as any);
    mockPaymentUpdate.mockResolvedValue({ status: 'failed' } as any);

    const result = await reconcileStalePayments();

    expect(result.reconciledCount).toBe(2);
    expect(result.details).toHaveLength(2);
    expect(mockPaymentUpdate).toHaveBeenCalledTimes(2);
  });
});
