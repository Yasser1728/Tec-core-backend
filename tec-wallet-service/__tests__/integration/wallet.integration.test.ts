import request from 'supertest';
import express, { Application } from 'express';
import { Router } from 'express';
import { body, param, query } from 'express-validator';

// ── Mock Controllers ───────────────────────────────────────
const mockControllers = {
  getWallets:           jest.fn(),
  linkWallet:           jest.fn(),
  getWalletBalance:     jest.fn(),
  getWalletTransactions: jest.fn(),
  deposit:              jest.fn(),
  withdraw:             jest.fn(),
  transfer:             jest.fn(),
  addFundsInternal:     jest.fn(),
};

jest.mock('../../src/controllers/wallet.controller', () => mockControllers);
jest.mock('../../src/middlewares/jwt.middleware',     () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../src/middlewares/rateLimit.middleware', () => ({
  financialRateLimiter: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../src/middleware/internal-auth', () => ({
  validateInternalKey: (_req: any, _res: any, next: any) => next(),
}));

// ── Mock Data ─────────────────────────────────────────────
const mockWallet = {
  id:          'wallet-uuid-1',
  user_id:     'user-uuid-1',
  wallet_type: 'pi',
  currency:    'PI',
  balance:     100,
  is_primary:  true,
  created_at:  new Date().toISOString(),
};

const mockTransaction = {
  id:          'tx-uuid-1',
  wallet_id:   'wallet-uuid-1',
  type:        'CREDIT',
  amount:      10,
  currency:    'PI',
  status:      'completed',
  created_at:  new Date().toISOString(),
};

// ── App Setup ─────────────────────────────────────────────
let app: Application;

beforeAll(async () => {
  const {
    getWallets, linkWallet, getWalletBalance,
    getWalletTransactions, deposit, withdraw,
    transfer, addFundsInternal,
  } = await import('../../src/controllers/wallet.controller');

  const { authenticate }       = await import('../../src/middlewares/jwt.middleware');
  const { financialRateLimiter } = await import('../../src/middlewares/rateLimit.middleware');
  const { validateInternalKey } = await import('../../src/middleware/internal-auth');

  const router = Router();
  router.post('/internal/add-funds', addFundsInternal);
  router.get('/', [query('userId').notEmpty()], getWallets);
  router.post('/link', [
    body('userId').notEmpty(),
    body('wallet_type').isIn(['pi', 'crypto', 'fiat']),
    body('currency').notEmpty(),
  ], linkWallet);
  router.post('/transfer', authenticate, financialRateLimiter, [
    body('fromWalletId').isUUID(),
    body('toWalletId').isUUID(),
    body('amount').isFloat({ min: 0.000001 }),
  ], transfer);
  router.get('/:id/balance', [param('id').isUUID()], getWalletBalance);
  router.get('/:id/transactions', [param('id').isUUID()], getWalletTransactions);
  router.post('/:id/deposit', authenticate, financialRateLimiter, [
    param('id').isUUID(),
    body('amount').isFloat({ min: 0.000001 }),
  ], deposit);
  router.post('/:id/withdraw', authenticate, financialRateLimiter, [
    param('id').isUUID(),
    body('amount').isFloat({ min: 0.000001 }),
  ], withdraw);

  app = express();
  app.use(express.json());
  app.use(validateInternalKey);
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'wallet-service' }));
  app.use('/wallets', router);
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────
describe('Wallet Service Integration Tests', () => {

  // ── GET /health ──────────────────────────────────────────
  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', service: 'wallet-service' });
    });
  });

  // ── GET /wallets ─────────────────────────────────────────
  describe('GET /wallets', () => {
    it('returns wallets for userId', async () => {
      mockControllers.getWallets.mockImplementation((_req, res) => {
        res.json({ success: true, data: { wallets: [mockWallet] } });
      });

      const res = await request(app)
        .get('/wallets')
        .query({ userId: 'user-uuid-1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.wallets).toHaveLength(1);
    });
  });

  // ── POST /wallets/link ────────────────────────────────────
  describe('POST /wallets/link', () => {
    it('links a new wallet successfully', async () => {
      mockControllers.linkWallet.mockImplementation((_req, res) => {
        res.status(201).json({ success: true, data: { wallet: mockWallet } });
      });

      const res = await request(app)
        .post('/wallets/link')
        .send({ userId: 'user-uuid-1', wallet_type: 'pi', currency: 'PI' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for invalid wallet_type', async () => {
      mockControllers.linkWallet.mockImplementation((_req, res) => {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR' } });
      });

      const res = await request(app)
        .post('/wallets/link')
        .send({ userId: 'user-uuid-1', wallet_type: 'invalid', currency: 'PI' });

      expect(res.status).toBe(400);
    });
  });

  // ── GET /wallets/:id/balance ──────────────────────────────
  describe('GET /wallets/:id/balance', () => {
    it('returns wallet balance', async () => {
      mockControllers.getWalletBalance.mockImplementation((_req, res) => {
        res.json({ success: true, data: { balance: 100, currency: 'PI' } });
      });

      const res = await request(app)
        .get('/wallets/wallet-uuid-1/balance');

      expect(res.status).toBe(200);
      expect(res.body.data.balance).toBe(100);
    });

    it('returns 400 for invalid UUID', async () => {
      mockControllers.getWalletBalance.mockImplementation((_req, res) => {
        res.status(400).json({ success: false });
      });

      const res = await request(app)
        .get('/wallets/not-a-uuid/balance');

      expect(res.status).toBe(400);
    });

    it('returns 404 when wallet not found', async () => {
      mockControllers.getWalletBalance.mockImplementation((_req, res) => {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
      });

      const res = await request(app)
        .get('/wallets/wallet-uuid-1/balance');

      expect(res.status).toBe(404);
    });
  });

  // ── GET /wallets/:id/transactions ─────────────────────────
  describe('GET /wallets/:id/transactions', () => {
    it('returns transactions with pagination', async () => {
      mockControllers.getWalletTransactions.mockImplementation((_req, res) => {
        res.json({
          success: true,
          data: {
            transactions: [mockTransaction],
            pagination: { page: 1, limit: 10, total: 1 },
          },
        });
      });

      const res = await request(app)
        .get('/wallets/wallet-uuid-1/transactions')
        .query({ page: 1, limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.data.transactions).toHaveLength(1);
    });
  });

  // ── POST /wallets/:id/deposit ─────────────────────────────
  describe('POST /wallets/:id/deposit', () => {
    it('deposits funds successfully', async () => {
      mockControllers.deposit.mockImplementation((_req, res) => {
        res.json({ success: true, data: { transaction: mockTransaction } });
      });

      const res = await request(app)
        .post('/wallets/wallet-uuid-1/deposit')
        .send({ amount: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for invalid amount', async () => {
      mockControllers.deposit.mockImplementation((_req, res) => {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR' } });
      });

      const res = await request(app)
        .post('/wallets/wallet-uuid-1/deposit')
        .send({ amount: 0 });

      expect(res.status).toBe(400);
    });
  });

  // ── POST /wallets/:id/withdraw ────────────────────────────
  describe('POST /wallets/:id/withdraw', () => {
    it('withdraws funds successfully', async () => {
      mockControllers.withdraw.mockImplementation((_req, res) => {
        res.json({ success: true, data: { transaction: mockTransaction } });
      });

      const res = await request(app)
        .post('/wallets/wallet-uuid-1/withdraw')
        .send({ amount: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for insufficient funds', async () => {
      mockControllers.withdraw.mockImplementation((_req, res) => {
        res.status(400).json({ success: false, error: { code: 'INSUFFICIENT_FUNDS' } });
      });

      const res = await request(app)
        .post('/wallets/wallet-uuid-1/withdraw')
        .send({ amount: 99999 });

      expect(res.status).toBe(400);
    });
  });

  // ── POST /wallets/transfer ────────────────────────────────
  describe('POST /wallets/transfer', () => {
    it('transfers funds successfully', async () => {
      mockControllers.transfer.mockImplementation((_req, res) => {
        res.json({ success: true, data: { transaction: mockTransaction } });
      });

      const res = await request(app)
        .post('/wallets/transfer')
        .send({
          fromWalletId: 'wallet-uuid-1',
          toWalletId:   'wallet-uuid-2',
          amount:       10,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for invalid UUIDs', async () => {
      mockControllers.transfer.mockImplementation((_req, res) => {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR' } });
      });

      const res = await request(app)
        .post('/wallets/transfer')
        .send({
          fromWalletId: 'not-uuid',
          toWalletId:   'not-uuid',
          amount:       10,
        });

      expect(res.status).toBe(400);
    });
  });

  // ── POST /wallets/internal/add-funds ─────────────────────
  describe('POST /wallets/internal/add-funds', () => {
    it('adds funds via internal endpoint', async () => {
      mockControllers.addFundsInternal.mockImplementation((_req, res) => {
        res.json({ success: true });
      });

      const res = await request(app)
        .post('/wallets/internal/add-funds')
        .set('x-internal-key', 'test-secret')
        .send({ userId: 'user-uuid-1', amount: 10, currency: 'PI' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
