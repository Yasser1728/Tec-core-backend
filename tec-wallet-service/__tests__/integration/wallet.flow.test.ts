import request from 'supertest';
import { v4 as uuid } from 'uuid';

// ── Mock everything before app import ────────────────────
const mockFindMany    = jest.fn();
const mockFindUnique  = jest.fn();
const mockFindFirst   = jest.fn();
const mockCreate      = jest.fn();
const mockUpdate      = jest.fn();
const mockCount       = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../../src/config/database', () => ({
  prisma: {
    wallet: {
      findMany:   mockFindMany,
      findUnique: mockFindUnique,
      findFirst:  mockFindFirst,
      create:     mockCreate,
      update:     mockUpdate,
    },
    transaction: {
      findMany: mockFindMany,
      create:   mockCreate,
      count:    mockCount,
    },
    auditLog: { create: jest.fn() },
    $transaction: mockTransaction,
  },
}));

jest.mock('../../src/infra/observability', () => ({
  initSentry:      jest.fn(),
  Sentry:          { captureException: jest.fn() },
  isSentryEnabled: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/infra/metrics', () => ({
  register: { metrics: jest.fn().mockResolvedValue(''), contentType: 'text/plain' },
}));

jest.mock('../../src/middleware/metrics', () => ({
  metricsMiddleware: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../src/middleware/request-id', () => ({
  requestIdMiddleware: (_req: any, _res: any, next: any) => next(),
}));

// ✅ Fix: mockResolvedValue instead of jest.fn()
jest.mock('../../src/wallet-event-consumer', () => ({
  startWalletEventConsumer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/middlewares/jwt.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user   = { id: 'user-test-123', role: 'user' };
    req.userId = 'user-test-123';
    next();
  },
}));

import app from '../../src/index';

const INTERNAL_SECRET = 'test-internal-secret';
const USER_ID         = 'user-test-123';

const makeWallet = (overrides = {}) => ({
  id:             uuid(),
  user_id:        USER_ID,
  wallet_type:    'pi',
  currency:       'PI',
  balance:        10,
  is_primary:     true,
  wallet_address: null,
  created_at:     new Date(),
  updated_at:     new Date(),
  ...overrides,
});

const makeTx = (overrides = {}) => ({
  id:          uuid(),
  wallet_id:   uuid(),
  type:        'deposit',
  amount:      1,
  currency:    'PI',
  asset_type:  'PI',
  status:      'completed',
  description: null,
  metadata:    {},
  created_at:  new Date(),
  updated_at:  new Date(),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.INTERNAL_SECRET      = INTERNAL_SECRET;
  process.env.SUPPORTED_CURRENCIES = 'PI,TEC,USD';
});

describe('GET /health', () => {
  it('returns 200 with service info', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('wallet-service');
  });
});

describe('GET /wallets', () => {
  it('returns wallets for a user', async () => {
    const wallet = makeWallet();
    mockFindMany.mockResolvedValue([wallet]);
    const res = await request(app)
      .get(`/wallets?userId=${USER_ID}`)
      .set('x-internal-key', INTERNAL_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.data.wallets).toHaveLength(1);
  });

  it('returns empty array when no wallets', async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await request(app)
      .get(`/wallets?userId=${uuid()}`)
      .set('x-internal-key', INTERNAL_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.data.wallets).toEqual([]);
  });
});

describe('GET /wallets/:id/balance', () => {
  it('returns wallet balance', async () => {
    const wallet = makeWallet({ balance: 17.5 });
    mockFindUnique.mockResolvedValue(wallet);
    const res = await request(app)
      .get(`/wallets/${wallet.id}/balance`)
      .set('x-internal-key', INTERNAL_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.data.wallet.balance).toBe(17.5);
  });

  it('returns 404 when wallet not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(app)
      .get(`/wallets/${uuid()}/balance`)
      .set('x-internal-key', INTERNAL_SECRET);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /wallets/:id/transactions', () => {
  it('returns transactions with pagination', async () => {
    const walletId = uuid();
    mockCount.mockResolvedValue(3);
    mockFindMany.mockResolvedValue([makeTx(), makeTx(), makeTx()]);
    const res = await request(app)
      .get(`/wallets/${walletId}/transactions?page=1&limit=10`)
      .set('x-internal-key', INTERNAL_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(3);
    expect(res.body.data.pagination.total).toBe(3);
  });

  it('filters by type', async () => {
    const walletId = uuid();
    mockCount.mockResolvedValue(1);
    mockFindMany.mockResolvedValue([makeTx({ type: 'deposit' })]);
    const res = await request(app)
      .get(`/wallets/${walletId}/transactions?type=deposit`)
      .set('x-internal-key', INTERNAL_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.data.transactions[0].type).toBe('deposit');
  });
});

describe('POST /wallets/:id/deposit', () => {
  it('deposits funds successfully', async () => {
    const walletId = uuid();
    const wallet   = makeWallet({ id: walletId, balance: 10 });
    const updated  = makeWallet({ id: walletId, balance: 11 });
    const tx       = makeTx({ type: 'deposit', amount: 1 });
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      wallet:      { findUnique: jest.fn().mockResolvedValue(wallet), update: jest.fn().mockResolvedValue(updated) },
      transaction: { create: jest.fn().mockResolvedValue(tx) },
      auditLog:    { create: jest.fn() },
    }));
    const res = await request(app)
      .post(`/wallets/${walletId}/deposit`)
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Authorization', 'Bearer test-token')
      .send({ amount: 1, assetType: 'PI' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 when amount is zero', async () => {
    const res = await request(app)
      .post(`/wallets/${uuid()}/deposit`)
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Authorization', 'Bearer test-token')
      .send({ amount: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for unsupported currency', async () => {
    const walletId = uuid();
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      wallet:      { findUnique: jest.fn().mockResolvedValue(makeWallet({ id: walletId })), update: jest.fn() },
      transaction: { create: jest.fn() },
      auditLog:    { create: jest.fn() },
    }));
    const res = await request(app)
      .post(`/wallets/${walletId}/deposit`)
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Authorization', 'Bearer test-token')
      .send({ amount: 1, assetType: 'DOGE' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_CURRENCY');
  });

  it('returns 404 when wallet not found', async () => {
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      wallet:      { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
      transaction: { create: jest.fn() },
      auditLog:    { create: jest.fn() },
    }));
    const res = await request(app)
      .post(`/wallets/${uuid()}/deposit`)
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Authorization', 'Bearer test-token')
      .send({ amount: 1 });
    expect(res.status).toBe(404);
  });
});

describe('POST /wallets/:id/withdraw', () => {
  it('withdraws funds successfully', async () => {
    const walletId = uuid();
    const wallet   = makeWallet({ id: walletId, balance: 10 });
    const updated  = makeWallet({ id: walletId, balance: 9 });
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      wallet:      { findUnique: jest.fn().mockResolvedValue(wallet), update: jest.fn().mockResolvedValue(updated) },
      transaction: { create: jest.fn().mockResolvedValue(makeTx()) },
      auditLog:    { create: jest.fn() },
    }));
    const res = await request(app)
      .post(`/wallets/${walletId}/withdraw`)
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Authorization', 'Bearer test-token')
      .send({ amount: 1, assetType: 'PI' });
    expect(res.status).toBe(200);
  });

  it('returns 422 when balance insufficient', async () => {
    const walletId = uuid();
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      wallet:      { findUnique: jest.fn().mockResolvedValue(makeWallet({ id: walletId, balance: 5 })), update: jest.fn() },
      transaction: { create: jest.fn() },
      auditLog:    { create: jest.fn() },
    }));
    const res = await request(app)
      .post(`/wallets/${walletId}/withdraw`)
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Authorization', 'Bearer test-token')
      .send({ amount: 100 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });
});

describe('POST /wallets/transfer', () => {
  it('transfers funds between wallets', async () => {
    const fromId = uuid();
    const toId   = uuid();
    const from   = makeWallet({ id: fromId, balance: 10 });
    const to     = makeWallet({ id: toId, balance: 5, is_primary: false });
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      wallet: {
        findUnique: jest.fn().mockResolvedValueOnce(from).mockResolvedValueOnce(to),
        update:     jest.fn().mockResolvedValueOnce({ ...from, balance: 9 }).mockResolvedValueOnce({ ...to, balance: 6 }),
      },
      transaction: { create: jest.fn().mockResolvedValue(makeTx()) },
      auditLog:    { create: jest.fn() },
    }));
    const res = await request(app)
      .post('/wallets/transfer')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Authorization', 'Bearer test-token')
      .send({ fromWalletId: fromId, toWalletId: toId, amount: 1 });
    expect(res.status).toBe(200);
  });

  it('returns 400 when source and destination are the same', async () => {
    const walletId = uuid();
    const res = await request(app)
      .post('/wallets/transfer')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Authorization', 'Bearer test-token')
      .send({ fromWalletId: walletId, toWalletId: walletId, amount: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TRANSFER');
  });

  it('returns 422 when insufficient balance', async () => {
    const fromId = uuid();
    const toId   = uuid();
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      wallet: {
        findUnique: jest.fn().mockResolvedValueOnce(makeWallet({ id: fromId, balance: 1 })).mockResolvedValueOnce(makeWallet({ id: toId })),
        update: jest.fn(),
      },
      transaction: { create: jest.fn() },
      auditLog:    { create: jest.fn() },
    }));
    const res = await request(app)
      .post('/wallets/transfer')
      .set('x-internal-key', INTERNAL_SECRET)
      .set('Authorization', 'Bearer test-token')
      .send({ fromWalletId: fromId, toWalletId: toId, amount: 100 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });
});

describe('POST /wallets/internal/add-funds', () => {
  it('credits wallet from payment event', async () => {
    const walletId = uuid();
    const wallet   = makeWallet({ id: walletId, balance: 10, currency: 'TEC' });
    mockFindFirst.mockResolvedValue(wallet);
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      wallet:      { update: jest.fn().mockResolvedValue({ ...wallet, balance: 11 }) },
      transaction: { create: jest.fn().mockResolvedValue(makeTx()) },
      auditLog:    { create: jest.fn() },
    }));
    const res = await request(app)
      .post('/wallets/internal/add-funds')
      .set('x-internal-key', INTERNAL_SECRET)
      .send({ userId: USER_ID, amount: 1, currency: 'TEC', referenceId: 'pay-123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('creates new wallet if none exists', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue(makeWallet({ currency: 'TEC', balance: 0 }));
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      wallet:      { update: jest.fn().mockResolvedValue(makeWallet({ balance: 1 })) },
      transaction: { create: jest.fn().mockResolvedValue(makeTx()) },
      auditLog:    { create: jest.fn() },
    }));
    const res = await request(app)
      .post('/wallets/internal/add-funds')
      .set('x-internal-key', INTERNAL_SECRET)
      .send({ userId: USER_ID, amount: 1, currency: 'TEC', referenceId: 'pay-456' });
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalled();
  });

  it('returns 400 when userId missing', async () => {
    const res = await request(app)
      .post('/wallets/internal/add-funds')
      .set('x-internal-key', INTERNAL_SECRET)
      .send({ amount: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when amount is negative', async () => {
    const res = await request(app)
      .post('/wallets/internal/add-funds')
      .set('x-internal-key', INTERNAL_SECRET)
      .send({ userId: USER_ID, amount: -5 });
    expect(res.status).toBe(400);
  });

  it('returns 403 when internal key is wrong', async () => {
    const res = await request(app)
      .post('/wallets/internal/add-funds')
      .set('x-internal-key', 'wrong-key')
      .send({ userId: USER_ID, amount: 1 });
    expect(res.status).toBe(403);
  });
});

describe('Wallet full flow — Payment event credits wallet', () => {
  it('complete Payment→Wallet credit flow', async () => {
    const walletId = uuid();
    const wallet   = makeWallet({ id: walletId, balance: 0, currency: 'TEC' });
    mockFindFirst.mockResolvedValue(wallet);
    mockTransaction.mockImplementation(async (fn: Function) => fn({
      wallet:      { update: jest.fn().mockResolvedValue({ ...wallet, balance: 1 }) },
      transaction: { create: jest.fn().mockResolvedValue(makeTx({ amount: 1 })) },
      auditLog:    { create: jest.fn() },
    }));
    const credit = await request(app)
      .post('/wallets/internal/add-funds')
      .set('x-internal-key', INTERNAL_SECRET)
      .send({ userId: USER_ID, amount: 1, currency: 'TEC', referenceId: 'pay-flow-123' });
    expect(credit.status).toBe(200);

    mockFindUnique.mockResolvedValue({ ...wallet, balance: 1 });
    const balance = await request(app)
      .get(`/wallets/${walletId}/balance`)
      .set('x-internal-key', INTERNAL_SECRET);
    expect(balance.status).toBe(200);
    expect(balance.body.data.wallet.balance).toBe(1);
  });
});
