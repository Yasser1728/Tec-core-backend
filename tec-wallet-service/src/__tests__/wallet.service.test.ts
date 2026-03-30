import { WalletService } from '../wallet/wallet.service';
import { PaymentCompletedEvent } from '../event-bus';

// ── Mock Prisma ───────────────────────────────────────────
const mockTx = {
  processedEvent: {
    findUnique: jest.fn(),
    create:     jest.fn(),
  },
  wallet: {
    findFirst: jest.fn(),
    create:    jest.fn(),
    update:    jest.fn(),
  },
  transaction: {
    findMany: jest.fn(),
    create:   jest.fn(),
    count:    jest.fn(),
  },
  auditLog: { create: jest.fn() },
};

const mockPrisma = {
  $transaction: jest.fn(),
  wallet: {
    findFirst: jest.fn(),
    create:    jest.fn(),
    update:    jest.fn(),
  },
  transaction: {
    findMany: jest.fn(),
    count:    jest.fn(),
  },
};

const makeEvent = (overrides: Partial<PaymentCompletedEvent> = {}): PaymentCompletedEvent => ({
  paymentId:   'pay-001',
  userId:      'user-001',
  amount:      100,
  currency:    'PI',
  piPaymentId: 'pi-001',
  timestamp:   new Date().toISOString(),
  ...overrides,
});

const baseWallet = {
  id:          'wallet-001',
  user_id:     'user-001',
  wallet_type: 'pi',
  currency:    'PI',
  balance:     { toNumber: () => 0, valueOf: () => 0 } as any,
  is_primary:  true,
  created_at:  new Date(),
  updated_at:  new Date(),
};

let service: WalletService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new WalletService(mockPrisma as any);
});

// ═══════════════════════════════════════════════════════════
describe('WalletService — handlePaymentCompleted', () => {

  it('credits wallet successfully', async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));
    mockTx.processedEvent.findUnique.mockResolvedValue(null);
    mockTx.processedEvent.create.mockResolvedValue({});
    mockTx.wallet.findFirst.mockResolvedValue(baseWallet);
    mockTx.wallet.update.mockResolvedValue({ ...baseWallet, balance: 100 });
    mockTx.transaction.create.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await expect(service.handlePaymentCompleted(makeEvent())).resolves.not.toThrow();
    expect(mockTx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { balance: { increment: 100 } },
      })
    );
  });

  it('skips duplicate payment — idempotency', async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));
    mockTx.processedEvent.findUnique.mockResolvedValue({
      event_key: 'payment:pay-001',
      user_id:   'user-001',
    });

    await service.handlePaymentCompleted(makeEvent());

    expect(mockTx.wallet.update).not.toHaveBeenCalled();
    expect(mockTx.transaction.create).not.toHaveBeenCalled();
  });

  it('throws on zero amount', async () => {
    await expect(
      service.handlePaymentCompleted(makeEvent({ amount: 0 }))
    ).rejects.toThrow('Invalid amount');
  });

  it('throws on negative amount', async () => {
    await expect(
      service.handlePaymentCompleted(makeEvent({ amount: -50 }))
    ).rejects.toThrow('Invalid amount');
  });

  it('throws on missing paymentId', async () => {
    await expect(
      service.handlePaymentCompleted(makeEvent({ paymentId: '' }))
    ).rejects.toThrow('Invalid event');
  });

  it('throws on missing userId', async () => {
    await expect(
      service.handlePaymentCompleted(makeEvent({ userId: '' }))
    ).rejects.toThrow('Invalid event');
  });

  it('creates wallet if not exists', async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));
    mockTx.processedEvent.findUnique.mockResolvedValue(null);
    mockTx.processedEvent.create.mockResolvedValue({});
    mockTx.wallet.findFirst.mockResolvedValue(null); // مفيش wallet
    mockTx.wallet.create.mockResolvedValue(baseWallet);
    mockTx.wallet.update.mockResolvedValue({ ...baseWallet, balance: 100 });
    mockTx.transaction.create.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await service.handlePaymentCompleted(makeEvent());

    expect(mockTx.wallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id:    'user-001',
          is_primary: true,
        }),
      })
    );
  });

  it('creates ledger entry with correct idempotency key', async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));
    mockTx.processedEvent.findUnique.mockResolvedValue(null);
    mockTx.processedEvent.create.mockResolvedValue({});
    mockTx.wallet.findFirst.mockResolvedValue(baseWallet);
    mockTx.wallet.update.mockResolvedValue({ ...baseWallet, balance: 100 });
    mockTx.transaction.create.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await service.handlePaymentCompleted(makeEvent({ paymentId: 'pay-XYZ' }));

    expect(mockTx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: 'payment:pay-XYZ',
          type:        'CREDIT',
          amount:      100,
        }),
      })
    );
  });

  it('creates audit log with before/after balance', async () => {
    const walletWithBalance = {
      ...baseWallet,
      balance: { toNumber: () => 50, valueOf: () => 50 } as any,
    };
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));
    mockTx.processedEvent.findUnique.mockResolvedValue(null);
    mockTx.processedEvent.create.mockResolvedValue({});
    mockTx.wallet.findFirst.mockResolvedValue(walletWithBalance);
    mockTx.wallet.update.mockResolvedValue({});
    mockTx.transaction.create.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await service.handlePaymentCompleted(makeEvent({ amount: 25 }));

    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'credit',
          before: { balance: 50 },
          after:  { balance: 75 },
        }),
      })
    );
  });

  it('saves processedEvent before crediting', async () => {
    const callOrder: string[] = [];
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));
    mockTx.processedEvent.findUnique.mockResolvedValue(null);
    mockTx.processedEvent.create.mockImplementation(async () => {
      callOrder.push('processedEvent.create');
      return {};
    });
    mockTx.wallet.findFirst.mockResolvedValue(baseWallet);
    mockTx.wallet.update.mockImplementation(async () => {
      callOrder.push('wallet.update');
      return {};
    });
    mockTx.transaction.create.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await service.handlePaymentCompleted(makeEvent());

    expect(callOrder[0]).toBe('processedEvent.create');
    expect(callOrder[1]).toBe('wallet.update');
  });
});

// ═══════════════════════════════════════════════════════════
describe('WalletService — getBalance', () => {

  it('returns balance for existing wallet', async () => {
    mockPrisma.wallet.findFirst.mockResolvedValue({
      ...baseWallet,
      balance: { toNumber: () => 150 } as any,
    });

    const balance = await service.getBalance('user-001');
    expect(balance).toBe(150);
  });

  it('returns 0 for non-existent wallet', async () => {
    mockPrisma.wallet.findFirst.mockResolvedValue(null);

    const balance = await service.getBalance('user-999');
    expect(balance).toBe(0);
  });

  it('queries by userId and currency', async () => {
    mockPrisma.wallet.findFirst.mockResolvedValue(baseWallet);

    await service.getBalance('user-001', 'PI');

    expect(mockPrisma.wallet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id:    'user-001',
          currency:   'PI',
          is_primary: true,
        }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════
describe('WalletService — getTransactions', () => {

  it('returns transactions with pagination', async () => {
    const mockTransactions = [
      { id: 'tx-001', type: 'CREDIT', amount: 100 },
      { id: 'tx-002', type: 'CREDIT', amount: 50  },
    ];
    mockPrisma.wallet.findFirst.mockResolvedValue(baseWallet);
    mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);
    mockPrisma.transaction.count.mockResolvedValue(2);

    const result = await service.getTransactions('user-001');

    expect(result.transactions).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('returns empty for non-existent wallet', async () => {
    mockPrisma.wallet.findFirst.mockResolvedValue(null);

    const result = await service.getTransactions('user-999');

    expect(result.transactions).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('applies pagination correctly', async () => {
    mockPrisma.wallet.findFirst.mockResolvedValue(baseWallet);
    mockPrisma.transaction.findMany.mockResolvedValue([]);
    mockPrisma.transaction.count.mockResolvedValue(0);

    await service.getTransactions('user-001', { page: 2, limit: 5 });

    expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 })
    );
  });
});
