import { reconcileStalePayments } from '../src/services/reconciliation.service';

const mockFindMany = jest.fn();
const mockUpdate   = jest.fn();

jest.mock('../src/config/database', () => ({
  prisma: {
    payment: {
      findMany: (...args: any[]) => mockFindMany(...args),
      update:   (...args: any[]) => mockUpdate(...args),
    },
  },
}));

jest.mock('../src/utils/audit', () => ({
  createAuditLog: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logInfo:  jest.fn(),
  logWarn:  jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../src/config/env', () => ({
  env: {
    RECONCILE_CREATED_THRESHOLD_MS:  3600000,
    RECONCILE_APPROVED_THRESHOLD_MS: 1800000,
  },
}));

beforeEach(() => jest.clearAllMocks());

describe('ReconciliationService', () => {

  it('returns zero when no stale payments', async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await reconcileStalePayments();
    expect(result.reconciledCount).toBe(0);
    expect(result.details).toEqual([]);
  });

  it('reconciles stale payments and marks as failed', async () => {
    const stalePayments = [
      { id: 'pay-1', status: 'created', user_id: 'user-1' },
      { id: 'pay-2', status: 'approved', user_id: 'user-2' },
    ];
    mockFindMany.mockResolvedValue(stalePayments);
    mockUpdate.mockResolvedValue({});

    const result = await reconcileStalePayments();

    expect(result.reconciledCount).toBe(2);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('continues reconciling even if one payment fails', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'pay-ok',   status: 'created',  user_id: 'user-1' },
      { id: 'pay-fail', status: 'approved', user_id: 'user-2' },
    ]);
    mockUpdate
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('DB error'));

    const result = await reconcileStalePayments();
    expect(result.reconciledCount).toBe(1);
  });

  it('throws when DB query fails', async () => {
    mockFindMany.mockRejectedValue(new Error('Connection refused'));
    await expect(reconcileStalePayments()).rejects.toThrow('Connection refused');
  });

  it('includes original status in details', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'pay-1', status: 'created', user_id: 'user-1' },
    ]);
    mockUpdate.mockResolvedValue({});

    const result = await reconcileStalePayments();
    expect(result.details[0]).toMatchObject({
      id: 'pay-1',
      originalStatus: 'created',
    });
  });
});
