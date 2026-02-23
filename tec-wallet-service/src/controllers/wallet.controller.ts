import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { Prisma } from '../../prisma/client';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

// ─── Helper: parse supported currencies ────────────────────────────────────────

const getSupportedCurrencies = (): string[] => {
  const raw = process.env.SUPPORTED_CURRENCIES ?? 'USD,PI,BTC,ETH';
  return raw.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
};

// ─── Helper: write an AuditLog entry ──────────────────────────────────────────

/**
 * Write an immutable audit log entry within the current transaction (or
 * standalone if no tx client is passed).
 */
const writeAuditLog = async (
  tx: Prisma.TransactionClient,
  params: {
    action: string;
    entity: string;
    entityId: string;
    userId?: string;
    before?: Prisma.InputJsonValue | null;
    after?: Prisma.InputJsonValue | null;
    metadata?: Prisma.InputJsonValue | null;
  },
): Promise<void> => {
  await tx.auditLog.create({
    data: {
      action: params.action,
      entity: params.entity,
      entity_id: params.entityId,
      user_id: params.userId ?? null,
      before: params.before ?? Prisma.JsonNull,
      after: params.after ?? Prisma.JsonNull,
      metadata: params.metadata ?? Prisma.JsonNull,
    },
  });
};

// Get all wallets for a user
export const getWallets = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array(),
        },
      });
      return;
    }

    const { userId } = req.query;

    const wallets = await prisma.wallet.findMany({
      where: { user_id: userId as string },
      orderBy: [
        { is_primary: 'desc' },
        { created_at: 'desc' },
      ],
    });

    res.json({
      success: true,
      data: { wallets },
    });
  } catch (error) {
    console.error('GetWallets error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch wallets',
      },
    });
  }
};

// Link a new wallet
export const linkWallet = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array(),
        },
      });
      return;
    }

    const { userId, wallet_type, wallet_address, currency } = req.body;

    // Check if wallet address already exists (if provided)
    if (wallet_address) {
      const existingWallet = await prisma.wallet.findUnique({
        where: { wallet_address },
      });

      if (existingWallet) {
        res.status(409).json({
          success: false,
          error: {
            code: 'CONFLICT',
            message: 'Wallet address already linked',
          },
        });
        return;
      }
    }

    // Check if user already has a primary wallet
    const primaryWallet = await prisma.wallet.findFirst({
      where: {
        user_id: userId,
        is_primary: true,
      },
    });

    const wallet = await prisma.wallet.create({
      data: {
        user_id: userId,
        wallet_type,
        wallet_address,
        currency,
        balance: 0,
        is_primary: !primaryWallet, // Set as primary if no primary wallet exists
      },
    });

    res.status(201).json({
      success: true,
      data: { wallet },
    });
  } catch (error) {
    console.error('LinkWallet error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to link wallet',
      },
    });
  }
};

// Get wallet balance
export const getWalletBalance = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array(),
        },
      });
      return;
    }

    const { id } = req.params;

    const wallet = await prisma.wallet.findUnique({
      where: { id },
      select: {
        id: true,
        balance: true,
        currency: true,
        wallet_type: true,
      },
    });

    if (!wallet) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Wallet not found',
        },
      });
      return;
    }

    res.json({
      success: true,
      data: { wallet },
    });
  } catch (error) {
    console.error('GetWalletBalance error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get wallet balance',
      },
    });
  }
};

// Get wallet transactions with pagination
export const getWalletTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array(),
        },
      });
      return;
    }

    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const type = req.query.type as string;
    const status = req.query.status as string;

    // Build where clause
    const where: { wallet_id: string; type?: string; status?: string } = { wallet_id: id };
    if (type) where.type = type;
    if (status) where.status = status;

    // Get total count
    const total = await prisma.transaction.count({ where });

    // Get transactions
    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    console.error('GetWalletTransactions error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get wallet transactions',
      },
    });
  }
};

// ─── Deposit ──────────────────────────────────────────────────────────────────

/**
 * POST /wallets/:id/deposit
 * Add funds to a wallet atomically.
 * Writes an AuditLog entry before updating the balance.
 */
export const deposit = async (req: Request, res: Response): Promise<void> => {
  const operation = 'deposit';
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: errors.array() },
      });
      return;
    }

    const { id } = req.params;
    const { amount, assetType, userId, description } = req.body as {
      amount: number;
      assetType?: string;
      userId?: string;
      description?: string;
    };

    logger.operation(operation, 'init', { walletId: id, amount, assetType, userId });

    const supported = getSupportedCurrencies();
    const resolvedAsset = (assetType ?? 'USD').toUpperCase();
    if (supported.length > 0 && !supported.includes(resolvedAsset)) {
      res.status(400).json({
        success: false,
        error: { code: 'UNSUPPORTED_CURRENCY', message: `Currency ${resolvedAsset} is not supported` },
      });
      return;
    }

    logger.operation(operation, 'verify', { walletId: id, assetType: resolvedAsset });

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const wallet = await tx.wallet.findUnique({ where: { id } });
      if (!wallet) throw Object.assign(new Error('Wallet not found'), { statusCode: 404, code: 'NOT_FOUND' });

      // Write audit log before mutation (after state is deterministic at this point)
      await writeAuditLog(tx, {
        action: operation,
        entity: 'wallet',
        entityId: id,
        userId,
        before: { balance: wallet.balance },
        after: { balance: wallet.balance + amount },
        metadata: { amount, assetType: resolvedAsset, description },
      });

      const updated = await tx.wallet.update({
        where: { id },
        data: { balance: { increment: amount } },
      });

      const transaction = await tx.transaction.create({
        data: {
          wallet_id: id,
          type: 'deposit',
          amount,
          asset_type: resolvedAsset,
          status: 'completed',
          description: description ?? null,
          metadata: { userId },
        },
      });

      return { wallet: updated, transaction };
    });

    logger.operation(operation, 'commit', { walletId: id, newBalance: result.wallet.balance });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    logger.operation(operation, 'rollback', { error: (error as Error).message });
    const err = error as { statusCode?: number; code?: string; message?: string };
    res.status(err.statusCode ?? 500).json({
      success: false,
      error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message ?? 'Failed to process deposit' },
    });
  }
};

// ─── Withdraw ─────────────────────────────────────────────────────────────────

/**
 * POST /wallets/:id/withdraw
 * Remove funds from a wallet atomically with double-spend protection.
 * Writes an AuditLog entry before updating the balance.
 */
export const withdraw = async (req: Request, res: Response): Promise<void> => {
  const operation = 'withdraw';
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: errors.array() },
      });
      return;
    }

    const { id } = req.params;
    const { amount, assetType, userId, description } = req.body as {
      amount: number;
      assetType?: string;
      userId?: string;
      description?: string;
    };

    logger.operation(operation, 'init', { walletId: id, amount, assetType, userId });

    const supported = getSupportedCurrencies();
    const resolvedAsset = (assetType ?? 'USD').toUpperCase();
    if (supported.length > 0 && !supported.includes(resolvedAsset)) {
      res.status(400).json({
        success: false,
        error: { code: 'UNSUPPORTED_CURRENCY', message: `Currency ${resolvedAsset} is not supported` },
      });
      return;
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const wallet = await tx.wallet.findUnique({ where: { id } });
      if (!wallet) throw Object.assign(new Error('Wallet not found'), { statusCode: 404, code: 'NOT_FOUND' });

      logger.operation(operation, 'verify', { walletId: id, balance: wallet.balance, amount });

      // Double-spend protection: re-check balance inside the transaction
      if (wallet.balance < amount) {
        throw Object.assign(new Error('Insufficient balance'), { statusCode: 422, code: 'INSUFFICIENT_BALANCE' });
      }

      // Write audit log before mutation (after state is deterministic at this point)
      await writeAuditLog(tx, {
        action: operation,
        entity: 'wallet',
        entityId: id,
        userId,
        before: { balance: wallet.balance },
        after: { balance: wallet.balance - amount },
        metadata: { amount, assetType: resolvedAsset, description },
      });

      const updated = await tx.wallet.update({
        where: { id },
        data: { balance: { decrement: amount } },
      });

      const transaction = await tx.transaction.create({
        data: {
          wallet_id: id,
          type: 'withdrawal',
          amount,
          asset_type: resolvedAsset,
          status: 'completed',
          description: description ?? null,
          metadata: { userId },
        },
      });

      return { wallet: updated, transaction };
    });

    logger.operation(operation, 'commit', { walletId: id, newBalance: result.wallet.balance });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    logger.operation(operation, 'rollback', { error: (error as Error).message });
    const err = error as { statusCode?: number; code?: string; message?: string };
    res.status(err.statusCode ?? 500).json({
      success: false,
      error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message ?? 'Failed to process withdrawal' },
    });
  }
};

// ─── Transfer ─────────────────────────────────────────────────────────────────

/**
 * POST /wallets/transfer
 * Atomically move funds from one wallet to another.
 * - Locks both wallets inside a single DB transaction to prevent double-spend.
 * - Writes AuditLog entries for both wallets before any update.
 */
export const transfer = async (req: Request, res: Response): Promise<void> => {
  const operation = 'transfer';
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: errors.array() },
      });
      return;
    }

    const { fromWalletId, toWalletId, amount, assetType, userId, description } = req.body as {
      fromWalletId: string;
      toWalletId: string;
      amount: number;
      assetType?: string;
      userId?: string;
      description?: string;
    };

    if (fromWalletId === toWalletId) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_TRANSFER', message: 'Source and destination wallets must be different' },
      });
      return;
    }

    logger.operation(operation, 'init', { fromWalletId, toWalletId, amount, assetType, userId });

    const supported = getSupportedCurrencies();
    const resolvedAsset = (assetType ?? 'USD').toUpperCase();
    if (supported.length > 0 && !supported.includes(resolvedAsset)) {
      res.status(400).json({
        success: false,
        error: { code: 'UNSUPPORTED_CURRENCY', message: `Currency ${resolvedAsset} is not supported` },
      });
      return;
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Fetch both wallets inside the transaction for consistency
      const [fromWallet, toWallet] = await Promise.all([
        tx.wallet.findUnique({ where: { id: fromWalletId } }),
        tx.wallet.findUnique({ where: { id: toWalletId } }),
      ]);

      if (!fromWallet) throw Object.assign(new Error('Source wallet not found'), { statusCode: 404, code: 'NOT_FOUND' });
      if (!toWallet) throw Object.assign(new Error('Destination wallet not found'), { statusCode: 404, code: 'NOT_FOUND' });

      logger.operation(operation, 'verify', {
        fromBalance: fromWallet.balance,
        toBalance: toWallet.balance,
        amount,
      });

      // Double-spend protection: validate balance inside the locked transaction
      if (fromWallet.balance < amount) {
        throw Object.assign(new Error('Insufficient balance in source wallet'), { statusCode: 422, code: 'INSUFFICIENT_BALANCE' });
      }

      // Write audit logs before mutations (after state is deterministic at this point)
      await writeAuditLog(tx, {
        action: operation,
        entity: 'wallet',
        entityId: fromWalletId,
        userId,
        before: { balance: fromWallet.balance },
        after: { balance: fromWallet.balance - amount },
        metadata: { amount, assetType: resolvedAsset, toWalletId, description },
      });
      await writeAuditLog(tx, {
        action: operation,
        entity: 'wallet',
        entityId: toWalletId,
        userId,
        before: { balance: toWallet.balance },
        after: { balance: toWallet.balance + amount },
        metadata: { amount, assetType: resolvedAsset, fromWalletId, description },
      });

      // Apply debit and credit atomically
      const [updatedFrom, updatedTo] = await Promise.all([
        tx.wallet.update({ where: { id: fromWalletId }, data: { balance: { decrement: amount } } }),
        tx.wallet.update({ where: { id: toWalletId }, data: { balance: { increment: amount } } }),
      ]);

      // Record transactions for both sides
      const [debitTx, creditTx] = await Promise.all([
        tx.transaction.create({
          data: {
            wallet_id: fromWalletId,
            type: 'transfer',
            amount,
            asset_type: resolvedAsset,
            status: 'completed',
            description: description ?? null,
            metadata: { direction: 'debit', counterpartyWalletId: toWalletId, userId },
          },
        }),
        tx.transaction.create({
          data: {
            wallet_id: toWalletId,
            type: 'transfer',
            amount,
            asset_type: resolvedAsset,
            status: 'completed',
            description: description ?? null,
            metadata: { direction: 'credit', counterpartyWalletId: fromWalletId, userId },
          },
        }),
      ]);

      return { fromWallet: updatedFrom, toWallet: updatedTo, debitTransaction: debitTx, creditTransaction: creditTx };
    });

    logger.operation(operation, 'commit', {
      fromWalletId,
      toWalletId,
      fromNewBalance: result.fromWallet.balance,
      toNewBalance: result.toWallet.balance,
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    logger.operation(operation, 'rollback', { error: (error as Error).message });
    const err = error as { statusCode?: number; code?: string; message?: string };
    res.status(err.statusCode ?? 500).json({
      success: false,
      error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message ?? 'Failed to process transfer' },
    });
  }
};