import { WalletService } from '../src/wallet/wallet.service';
import { PaymentCompletedEvent } from '../src/event-bus';

// ── Mock Prisma ──────────────────────────────────────────────
const mockFindUnique  = jest.fn();
const mockFindFirst   = jest.fn();
const mockCreate      = jest.fn();
const mockUpdate      = jest.fn();
const mockCount       = jest.fn();
const mockFindMany    = jest.fn();
const mockTransaction = jest.fn();

const mockPrisma = {
  wallet: {
    findFirst: mockFindFirst,
    create:    mockCreate,
    update:    mockUpdate,
  },
  transaction: {
    create:   mockCreate,
    findMany: mockFindMany,
    count:    mockCount,
  },
  processedEvent: {
    findUnique: mockFindUnique,
    create:     mockCreate,
  },
  auditLog: {
    create: mockCreate,
  },
  $transaction: mockTransaction,
} as any;

let service: WalletService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new WalletService(mockPrisma);
});

// ── Base event ───────────────────────────────────────────────
const baseEvent: PaymentCompletedEvent = {
  paymentId:   'pay-123',
  userId:      'user-456',
  amount:      1,
  currency:    'PI',
  piPaymentId: 'pi-789',
  timestamp:   new Date().toISOString(),
};

describe('WalletService — handlePaymentCompleted', () => {

  it('throws on missing paymentId', async () => {
    await expect(
      service.handlePaymentCompleted({ ...baseEvent, paymentId: '' }),
    ).rejects.toThrow('Invalid event: missing paymentId or userId');
  });

  it('throws on missing userId', async () => {
    await expect(
      service.handlePaymentCompleted({ ...baseEvent, userId: '' }),
    ).rejects.toThrow('Invalid event: missing paymentId or userId');
  });

  it('throws on zero amount', async () => {
    await expect(
      service.handlePaymentCompleted({ ...baseEvent, amount: 0 }),
    ).rejects.toThrow('Invalid amount: must be greater than zero');
  });

  it('throws on negative amount', async () => {
    await expect(
      service.handlePaymentCompleted({ ...baseEvent, amount: -5 }),
    ).rejects.toThrow('Invalid amount: must be greater than zero');
  });

  it('processes event inside transaction', async () => {
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      processedEvent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      wallet:         { findFirst: jest.fn().mockResolvedValue({ id: 'w-1', balance: 10 }), update: jest.fn(), create: jest.fn() },
      transaction:    { create: jest.fn() },
      auditLog:       { create: jest.fn() },
    }));
    await expect(service.handlePaymentCompleted(baseEvent)).resolves.not.toThrow();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('skips duplicate event (idempotency)', async () => {
    const txMock = {
      processedEvent: {
        findUnique: jest.fn().mockResolvedValue({ event_key: 'payment:pay-123' }),
        create: jest.fn(),
      },
      wallet:      { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
      transaction: { create: jest.fn() },
      auditLog:    { create: jest.fn() },
    };
    mockTransaction.mockImplementation(async (fn: Function) => fn(txMock));
    await service.handlePaymentCompleted(baseEvent);
    expect(txMock.wallet.update).not.toHaveBeenCalled();
  });

  it('creates new wallet if none exists', async () => {
    const createWallet = jest.fn().mockResolvedValue({ id: 'w-new', balance: 0 });
    const txMock = {
      processedEvent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      wallet:         { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn(), create: createWallet },
      transaction:    { create: jest.fn() },
      auditLog:       { create: jest.fn() },
    };
    mockTransaction.mockImplementation(async (fn: Function) => fn(txMock));
    await service.handlePaymentCompleted(baseEvent);
    expect(createWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id:    'user-456',
          currency:   'PI',
          is_primary: true,
        }),
      }),
    );
  });

  it('credits existing wallet balance', async () => {
    const updateWallet = jest.fn().mockResolvedValue({});
    const txMock = {
      processedEvent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      wallet:         { findFirst: jest.fn().mockResolvedValue({ id: 'w-1', balance: 10 }), update: updateWallet, create: jest.fn() },
      transaction:    { create: jest.fn() },
      auditLog:       { create: jest.fn() },
    };
    mockTransaction.mockImplementation(async (fn: Function) => fn(txMock));
    await service.handlePaymentCompleted(baseEvent);
    expect(updateWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'w-1' },
        data:  { balance: { increment: 1 } },
      }),
    );
  });

  it('creates ledger transaction record', async () => {
    const createTx = jest.fn().mockResolvedValue({});
    const txMock = {
      processedEvent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      wallet:         { findFirst: jest.fn().mockResolvedValue({ id: 'w-1', balance: 10 }), update: jest.fn(), create: jest.fn() },
      transaction:    { create: createTx },
      auditLog:       { create: jest.fn() },
    };
    mockTransaction.mockImplementation(async (fn: Function) => fn(txMock));
    await service.handlePaymentCompleted(baseEvent);
    expect(createTx).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type:       'CREDIT',
          status:     'completed',
          payment_id: 'pay-123',
        }),
      }),
    );
  });

  it('creates audit log record', async () => {
    const createAudit = jest.fn().mockResolvedValue({});
    const txMock = {
      processedEvent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      wallet:         { findFirst: jest.fn().mockResolvedValue({ id: 'w-1', balance: 10 }), update: jest.fn(), create: jest.fn() },
      transaction:    { create: jest.fn() },
      auditLog:       { create: createAudit },
    };
    mockTransaction.mockImplementation(async (fn: Function) => fn(txMock));
    await service.handlePaymentCompleted(baseEvent);
    expect(createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'credit',
          entity: 'wallet',
        }),
      }),
    );
  });
});

describe('WalletService — getBalance', () => {

  it('returns balance for existing wallet', async () => {
    mockFindFirst.mockResolvedValue({ balance: 17.5 });
    const balance = await service.getBalance('user-456');
    expect(balance).toBe(17.5);
  });

  it('returns 0 when wallet not found', async () => {
    mockFindFirst.mockResolvedValue(null);
    const balance = await service.getBalance('user-000');
    expect(balance).toBe(0);
  });

  it('queries by userId and currency', async () => {
    mockFindFirst.mockResolvedValue({ balance: 5 });
    await service.getBalance('user-456', 'TEC');
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id:    'user-456',
          currency:   'TEC',
          is_primary: true,
        }),
      }),
    );
  });

  it('defaults currency to PI', async () => {
    mockFindFirst.mockResolvedValue({ balance: 5 });
    await service.getBalance('user-456');
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ currency: 'PI' }),
      }),
    );
  });
});

describe('WalletService — getTransactions', () => {

  it('returns empty when wallet not found', async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await service.getTransactions('user-000');
    expect(result).toEqual({ transactions: [], total: 0 });
  });

  it('returns transactions with total count', async () => {
    mockFindFirst.mockResolvedValue({ id: 'w-1' });
    mockFindMany.mockResolvedValue([{ id: 'tx-1' }, { id: 'tx-2' }]);
    mockCount.mockResolvedValue(2);

    const result = await service.getTransactions('user-456');
    expect(result.transactions).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('applies pagination correctly', async () => {
    mockFindFirst.mockResolvedValue({ id: 'w-1' });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await service.getTransactions('user-456', { page: 2, limit: 5 });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 }),
    );
  });

  it('orders by created_at desc', async () => {
    mockFindFirst.mockResolvedValue({ id: 'w-1' });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await service.getTransactions('user-456');
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { created_at: 'desc' },
      }),
    );
  });
});
