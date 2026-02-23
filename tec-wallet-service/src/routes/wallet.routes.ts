import { Router } from 'express';
import { body, param, query } from 'express-validator';
import {
  getWallets,
  linkWallet,
  getWalletBalance,
  getWalletTransactions,
  deposit,
  withdraw,
  transfer,
} from '../controllers/wallet.controller';
import { financialRateLimiter } from '../middlewares/rateLimit.middleware';

const router = Router();

// GET /wallets - Get all wallets for a user
router.get(
  '/',
  [query('userId').notEmpty()],
  getWallets
);

// POST /wallets/link - Link a new wallet
router.post(
  '/link',
  [
    body('userId').notEmpty(),
    body('wallet_type').isIn(['pi', 'crypto', 'fiat']),
    body('wallet_address').optional(),
    body('currency').notEmpty(),
  ],
  linkWallet
);

// POST /wallets/transfer - Transfer funds between wallets (rate limited)
router.post(
  '/transfer',
  financialRateLimiter,
  [
    body('fromWalletId').isUUID(),
    body('toWalletId').isUUID(),
    body('amount').isFloat({ min: 0.000001 }),
    body('assetType').optional().isString().trim().notEmpty(),
    body('userId').optional().isString(),
    body('description').optional().isString(),
  ],
  transfer
);

// GET /wallets/:id/balance - Get wallet balance
router.get(
  '/:id/balance',
  [param('id').isUUID()],
  getWalletBalance
);

// GET /wallets/:id/transactions - Get wallet transactions with pagination
router.get(
  '/:id/transactions',
  [
    param('id').isUUID(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('type').optional().isIn(['deposit', 'withdrawal', 'transfer', 'payment']),
    query('status').optional().isIn(['pending', 'completed', 'failed']),
  ],
  getWalletTransactions
);

// POST /wallets/:id/deposit - Deposit funds (rate limited)
router.post(
  '/:id/deposit',
  financialRateLimiter,
  [
    param('id').isUUID(),
    body('amount').isFloat({ min: 0.000001 }),
    body('assetType').optional().isString().trim().notEmpty(),
    body('userId').optional().isString(),
    body('description').optional().isString(),
  ],
  deposit
);

// POST /wallets/:id/withdraw - Withdraw funds (rate limited)
router.post(
  '/:id/withdraw',
  financialRateLimiter,
  [
    param('id').isUUID(),
    body('amount').isFloat({ min: 0.000001 }),
    body('assetType').optional().isString().trim().notEmpty(),
    body('userId').optional().isString(),
    body('description').optional().isString(),
  ],
  withdraw
);

export default router;