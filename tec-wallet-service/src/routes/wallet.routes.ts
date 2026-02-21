import { Router } from 'express';
import { body, param, query } from 'express-validator';
import {
  getWallets,
  linkWallet,
  getWalletBalance,
  getWalletTransactions,
} from '../controllers/wallet.controller';

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

export default router;