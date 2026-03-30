import { Request, Response } from 'express';
import {
  getWallets,
  getWalletBalance,
  deposit,
  withdraw,
  transfer,
  addFundsInternal,
} from '../controllers/wallet.controller';

// ── Mock Prisma ───────────────────────────────────────────
jest.mock('../config/database', () => ({
  prisma: {
    wallet: {
      findMany:   jest.fn(),
      findUnique: jest.fn(),
      findFirst:  jest.fn(),
      create:     jest.fn(),
      update:     jest.fn(),
    },
    transaction: {
      findMany: jest.fn(),
      count:    jest.fn(),
      create:   jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { prisma } from '../config/database';

const mockReq = (overrides: Partial<Request> = {}): Request => ({
  body:    {},
  params:  {},
  query:   {},
  headers: {},
  userId:  'user-001',
  socket:  { remoteAddress: '127.0.0.1' } as any,
  ...overrides,
} as unknown as Request);

const mockRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res as Response;
};

const baseWallet = {
  id:          'wallet-001',
  user_id:     'user-001',
  wallet_type: 'pi',
  currency:    'PI',
  balance:     100,
  is_primary:  true,
  created_at:  new Date(),
  updated_at:  new Date(),
};

beforeEach(() => jest.clearAllMocks());

// ═══════════════════════════════════════════════════════════
describe('getWallets', () => {

  it('returns wallets for user', async () => {
    const req = mockReq({ query: { userId: 'user-001' } });
    const res = mockRes();
    (prisma.wallet.findMany as jest.Mock).mockResolvedValue([baseWallet]);

    await getWallets(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: { wallets: [baseWallet] } })
    );
  });

  it('returns empty array for user with no wallets', async () => {
    const req = mockReq({ query: { userId: 'user-999' } });
    const res = mockRes();
    (prisma.wallet.findMany as jest.Mock).mockResolvedValue([]);

    await getWallets(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { wallets: [] } })
    );
  });
});

// ═══════════════════════════════════════════════════════════
describe('getWalletBalance', () => {

  it('returns wallet balance', async () => {
    const req = mockReq({ params: { id: 'wallet-001' } });
    const res = mockRes();
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(baseWallet);

    await getWalletBalance(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('returns 404 when wallet not found', async () => {
    const req = mockReq({ params: { id: 'wallet-999' } });
    const res = mockRes();
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

    await getWalletBalance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════════════════════
describe('deposit', () => {

  it('deposits successfully', async () => {
    const req = mockReq({
      params: { id: 'wallet-001' },
      body:   { amount: 50, assetType: 'PI' },
    });
    const res = mockRes();
    const updated = { ...baseWallet, balance: 150 };
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({
        wallet: {
          findUnique: jest.fn().mockResolvedValue(baseWallet),
          update:     jest.fn().mockResolvedValue(updated),
        },
        transaction: { create: jest.fn().mockResolvedValue({}) },
        auditLog:    { create: jest.fn().mockResolvedValue({}) },
      })
    );

    await deposit(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('returns 404 when wallet not found', async () => {
    const req = mockReq({
      params: { id: 'wallet-999' },
      body:   { amount: 50 },
    });
    const res = mockRes();
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({
        wallet:      { findUnique: jest.fn().mockResolvedValue(null) },
        transaction: { create: jest.fn() },
        auditLog:    { create: jest.fn() },
      })
    );

    await deposit(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════════════════════
describe('withdraw', () => {

  it('withdraws successfully', async () => {
    const req = mockReq({
      params: { id: 'wallet-001' },
      body:   { amount: 50 },
    });
    const res = mockRes();
    const walletWithBalance = { ...baseWallet, balance: 100 };
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({
        wallet: {
          findUnique: jest.fn().mockResolvedValue(walletWithBalance),
          update:     jest.fn().mockResolvedValue({ ...baseWallet, balance: 50 }),
        },
        transaction: { create: jest.fn().mockResolvedValue({}) },
        auditLog:    { create: jest.fn().mockResolvedValue({}) },
      })
    );

    await withdraw(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('returns 422 for insufficient balance', async () => {
    const req = mockReq({
      params: { id: 'wallet-001' },
      body:   { amount: 9999 },
    });
    const res = mockRes();
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({
        wallet:      { findUnique: jest.fn().mockResolvedValue({ ...baseWallet, balance: 10 }) },
        transaction: { create: jest.fn() },
        auditLog:    { create: jest.fn() },
      })
    );

    await withdraw(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });
});

// ═══════════════════════════════════════════════════════════
describe('transfer', () => {

  it('returns 400 when same wallet', async () => {
    const req = mockReq({
      body: { fromWalletId: 'wallet-001', toWalletId: 'wallet-001', amount: 10 },
    });
    const res = mockRes();

    await transfer(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'INVALID_TRANSFER' }) })
    );
  });

  it('transfers successfully', async () => {
    const req = mockReq({
      body: { fromWalletId: 'wallet-001', toWalletId: 'wallet-002', amount: 30 },
    });
    const res = mockRes();
    const from = { ...baseWallet, id: 'wallet-001', balance: 100 };
    const to   = { ...baseWallet, id: 'wallet-002', balance: 50, user_id: 'user-002' };
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({
        wallet: {
          findUnique: jest.fn()
            .mockResolvedValueOnce(from)
            .mockResolvedValueOnce(to),
          update: jest.fn().mockResolvedValue({}),
        },
        transaction: { create: jest.fn().mockResolvedValue({}) },
        auditLog:    { create: jest.fn().mockResolvedValue({}) },
      })
    );

    await transfer(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('returns 422 for insufficient balance on transfer', async () => {
    const req = mockReq({
      body: { fromWalletId: 'wallet-001', toWalletId: 'wallet-002', amount: 9999 },
    });
    const res = mockRes();
    const from = { ...baseWallet, id: 'wallet-001', balance: 10 };
    const to   = { ...baseWallet, id: 'wallet-002', balance: 0, user_id: 'user-002' };
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({
        wallet: {
          findUnique: jest.fn()
            .mockResolvedValueOnce(from)
            .mockResolvedValueOnce(to),
        },
        transaction: { create: jest.fn() },
        auditLog:    { create: jest.fn() },
      })
    );

    await transfer(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });
});

// ═══════════════════════════════════════════════════════════
describe('addFundsInternal', () => {

  it('adds funds to existing wallet', async () => {
    const req = mockReq({
      body: { userId: 'user-001', amount: 100, currency: 'TEC' },
    });
    const res = mockRes();
    (prisma.wallet.findFirst as jest.Mock).mockResolvedValue(baseWallet);
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({
        wallet: {
          update: jest.fn().mockResolvedValue({ ...baseWallet, balance: 200 }),
        },
        transaction: { create: jest.fn().mockResolvedValue({}) },
        auditLog:    { create: jest.fn().mockResolvedValue({}) },
      })
    );

    await addFundsInternal(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('returns 400 for missing userId', async () => {
    const req = mockReq({ body: { amount: 100 } });
    const res = mockRes();

    await addFundsInternal(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for negative amount', async () => {
    const req = mockReq({ body: { userId: 'user-001', amount: -50 } });
    const res = mockRes();

    await addFundsInternal(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('creates new wallet if not exists', async () => {
    const req = mockReq({
      body: { userId: 'new-user', amount: 50, currency: 'TEC' },
    });
    const res = mockRes();
    (prisma.wallet.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)  // مفيش wallet
      .mockResolvedValueOnce(null); // مفيش primary
    (prisma.wallet.create as jest.Mock).mockResolvedValue({ ...baseWallet, user_id: 'new-user' });
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({
        wallet: {
          update: jest.fn().mockResolvedValue({ balance: 50 }),
        },
        transaction: { create: jest.fn().mockResolvedValue({}) },
        auditLog:    { create: jest.fn().mockResolvedValue({}) },
      })
    );

    await addFundsInternal(req, res);

    expect(prisma.wallet.create).toHaveBeenCalled();
  });
});
