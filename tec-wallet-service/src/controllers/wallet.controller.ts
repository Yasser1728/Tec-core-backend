import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { Prisma } from '../../prisma/client';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

// ─── Helpers ──────────────────────────────────────────────────
const getSupportedCurrencies = (): string[] => {
  const raw = process.env.SUPPORTED_CURRENCIES ?? 'USD,PI,BTC,ETH';
  return raw.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
};

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
      action:    params.action,
      entity:    params.entity,
      entity_id: params.entityId,
      user_id:   params.userId ?? '',
      before:    params.before   ?? Prisma.JsonNull,
      after:     params.after    ?? Prisma.JsonNull,
      metadata:  params.metadata ?? Prisma.JsonNull,
    },
  });
};

// ─── getWallets ───────────────────────────────────────────────
export const getWallets = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: errors.array() } });
      return;
    }

    const { userId } = req.query;
    const wallets = await prisma.wallet.findMany({
      where:   { user_id: userId as string },
      orderBy: [{ is_primary: 'desc' }, { created_at: 'desc' }],
    });

    res.json({ success: true, data: { wallets } });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch wallets' } });
  }
};

// ─── linkWallet ───────────────────────────────────────────────
export const linkWallet = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: errors.array() } });
      return;
    }

    const { userId, wallet_type, wallet_address, currency } = req.body;

    if (wallet_address) {
      const existing = await prisma.wallet.findUnique({ where: { wallet_address } });
      if (existing) {
        res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Wallet address already linked' } });
        return;
      }
    }

    const primaryWallet = await prisma.wallet.findFirst({ where: { user_id: userId, is_primary: true } });

    const wallet = await prisma.wallet.create({
      data: { user_id: userId, wallet_type, wallet_address, currency, balance: 0, is_primary: !primaryWallet },
    });

    res.status(201).json({ success: true, data: { wallet } });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to link wallet' } });
  }
};

// ─── getWalletBalance ─────────────────────────────────────────
export const getWalletBalance = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: errors.array() } });
      return;
    }

    const { id } = req.params;
    const wallet = await prisma.wallet.findUnique({
      where:  { id },
      select: { id: true, balance: true, currency: true, wallet_type: true },
    });

    if (!wallet) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Wallet not found' } });
      return;
    }

    res.json({ success: true, data: { wallet } });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get wallet balance' } });
  }
};

// ─── getWalletTransactions ────────────────────────────────────
export const getWalletTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: errors.array() } });
      return;
    }

    const { id }   = req.params;
    const page     = parseInt(req.query.page   as string) || 1;
    const limit    = parseInt(req.query.limit  as string) || 20;
    const type     = req.query.type   as string | undefined;
    const status   = req.query.status as string | undefined;

    const where: Prisma.TransactionWhereInput = { wallet_id: id };
    if (type)   where.type   = type;
    if (status) where.status = status;

    const [total, transactions] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);
    res.json({
      success: true,
      data: {
        transactions,
        pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get wallet transactions' } });
  }
};

// ─── deposit ──────────────────────────────────────────────────
export const deposit = async (req: Request, res: Response): Promise<void> => {
  const operation = 'deposit';
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: errors.array() } });
      return;
    }

    const { id } = req.params;
    const { amount, assetType, description } = req.body as { amount: number; assetType?: string; description?: string };
    const userId = req.userId ?? '';

    const supported     = getSupportedCurrencies();
    const resolvedAsset = (assetType ?? 'PI').toUpperCase();

    if (supported.length > 0 && !supported.includes(resolvedAsset)) {
      res.status(400).json({ success: false, error: { code: 'UNSUPPORTED_CURRENCY', message: `Currency ${resolvedAsset} is not supported` } });
      return;
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const wallet = await tx.wallet.findUnique({ where: { id } });
      if (!wallet) throw Object.assign(new Error('Wallet not found'), { statusCode: 404, code: 'NOT_FOUND' });

      const balanceBefore = Number(wallet.balance); // ← Decimal → number
      const balanceAfter  = balanceBefore + amount;

      await writeAuditLog(tx, {
        action: operation, entity: 'wallet', entityId: id, userId,
        before: { balance: balanceBefore },
        after:  { balance: balanceAfter },
        metadata: { amount, assetType: resolvedAsset, description },
      });

      const updated = await tx.wallet.update({
        where: { id },
        data:  { balance: { increment: amount } },
      });

      const transaction = await tx.transaction.create({
        data: {
          wallet_id:   id,
          type:        'deposit',
          amount,
          currency:    resolvedAsset, // ← أضفناه
          asset_type:  resolvedAsset,
          status:      'completed',
          description: description ?? null,
          metadata:    { userId },
        },
      });

      return { wallet: updated, transaction };
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    const err = error as { statusCode?: number; code?: string; message?: string };
    res.status(err.statusCode ?? 500).json({ success: false, error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message ?? 'Failed to process deposit' } });
  }
};

// ─── withdraw ─────────────────────────────────────────────────
export const withdraw = async (req: Request, res: Response): Promise<void> => {
  const operation = 'withdraw';
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: errors.array() } });
      return;
    }

    const { id } = req.params;
    const { amount, assetType, description } = req.body as { amount: number; assetType?: string; description?: string };
    const userId = req.userId ?? '';

    const supported     = getSupportedCurrencies();
    const resolvedAsset = (assetType ?? 'PI').toUpperCase();

    if (supported.length > 0 && !supported.includes(resolvedAsset)) {
      res.status(400).json({ success: false, error: { code: 'UNSUPPORTED_CURRENCY', message: `Currency ${resolvedAsset} is not supported` } });
      return;
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const wallet = await tx.wallet.findUnique({ where: { id } });
      if (!wallet) throw Object.assign(new Error('Wallet not found'), { statusCode: 404, code: 'NOT_FOUND' });

      const balanceBefore = Number(wallet.balance); // ← Decimal → number

      if (balanceBefore < amount) { // ← الآن كلاهما number
        throw Object.assign(new Error('Insufficient balance'), { statusCode: 422, code: 'INSUFFICIENT_BALANCE' });
      }

      const balanceAfter = balanceBefore - amount;

      await writeAuditLog(tx, {
        action: operation, entity: 'wallet', entityId: id, userId,
        before: { balance: balanceBefore },
        after:  { balance: balanceAfter },
        metadata: { amount, assetType: resolvedAsset, description },
      });

      const updated = await tx.wallet.update({
        where: { id },
        data:  { balance: { decrement: amount } },
      });

      const transaction = await tx.transaction.create({
        data: {
          wallet_id:   id,
          type:        'withdrawal',
          amount,
          currency:    resolvedAsset, // ← أضفناه
          asset_type:  resolvedAsset,
          status:      'completed',
          description: description ?? null,
          metadata:    { userId },
        },
      });

      return { wallet: updated, transaction };
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    const err = error as { statusCode?: number; code?: string; message?: string };
    res.status(err.statusCode ?? 500).json({ success: false, error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message ?? 'Failed to process withdrawal' } });
  }
};

// ─── transfer ─────────────────────────────────────────────────
export const transfer = async (req: Request, res: Response): Promise<void> => {
  const operation = 'transfer';
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details: errors.array() } });
      return;
    }

    const { fromWalletId, toWalletId, amount, assetType, description } = req.body as {
      fromWalletId: string; toWalletId: string; amount: number; assetType?: string; description?: string;
    };
    const userId = req.userId ?? '';

    if (fromWalletId === toWalletId) {
      res.status(400).json({ success: false, error: { code: 'INVALID_TRANSFER', message: 'Source and destination wallets must be different' } });
      return;
    }

    const supported     = getSupportedCurrencies();
    const resolvedAsset = (assetType ?? 'PI').toUpperCase();

    if (supported.length > 0 && !supported.includes(resolvedAsset)) {
      res.status(400).json({ success: false, error: { code: 'UNSUPPORTED_CURRENCY', message: `Currency ${resolvedAsset} is not supported` } });
      return;
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const [fromWallet, toWallet] = await Promise.all([
        tx.wallet.findUnique({ where: { id: fromWalletId } }),
        tx.wallet.findUnique({ where: { id: toWalletId } }),
      ]);

      if (!fromWallet) throw Object.assign(new Error('Source wallet not found'),      { statusCode: 404, code: 'NOT_FOUND' });
      if (!toWallet)   throw Object.assign(new Error('Destination wallet not found'), { statusCode: 404, code: 'NOT_FOUND' });

      const fromBalance = Number(fromWallet.balance); // ← Decimal → number
      const toBalance   = Number(toWallet.balance);

      if (fromBalance < amount) {
        throw Object.assign(new Error('Insufficient balance in source wallet'), { statusCode: 422, code: 'INSUFFICIENT_BALANCE' });
      }

      await writeAuditLog(tx, {
        action: operation, entity: 'wallet', entityId: fromWalletId, userId,
        before: { balance: fromBalance },
        after:  { balance: fromBalance - amount },
        metadata: { amount, assetType: resolvedAsset, toWalletId, description },
      });
      await writeAuditLog(tx, {
        action: operation, entity: 'wallet', entityId: toWalletId, userId,
        before: { balance: toBalance },
        after:  { balance: toBalance + amount },
        metadata: { amount, assetType: resolvedAsset, fromWalletId, description },
      });

      const [updatedFrom, updatedTo] = await Promise.all([
        tx.wallet.update({ where: { id: fromWalletId }, data: { balance: { decrement: amount } } }),
        tx.wallet.update({ where: { id: toWalletId },   data: { balance: { increment: amount } } }),
      ]);

      const [debitTx, creditTx] = await Promise.all([
        tx.transaction.create({
          data: {
            wallet_id:   fromWalletId,
            type:        'transfer',
            amount,
            currency:    resolvedAsset, // ← أضفناه
            asset_type:  resolvedAsset,
            status:      'completed',
            description: description ?? null,
            metadata:    { direction: 'debit',  counterpartyWalletId: toWalletId,   userId },
          },
        }),
        tx.transaction.create({
          data: {
            wallet_id:   toWalletId,
            type:        'transfer',
            amount,
            currency:    resolvedAsset, // ← أضفناه
            asset_type:  resolvedAsset,
            status:      'completed',
            description: description ?? null,
            metadata:    { direction: 'credit', counterpartyWalletId: fromWalletId, userId },
          },
        }),
      ]);

      return { fromWallet: updatedFrom, toWallet: updatedTo, debitTransaction: debitTx, creditTransaction: creditTx };
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    const err = error as { statusCode?: number; code?: string; message?: string };
    res.status(err.statusCode ?? 500).json({ success: false, error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message ?? 'Failed to process transfer' } });
  }
};

// ─── addFundsInternal ─────────────────────────────────────────
export const addFundsInternal = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, amount, currency = 'TEC', referenceId } = req.body as {
      userId: string; amount: number | string; currency?: string; referenceId?: string;
    };

    if (!userId || amount === undefined || amount === null || amount === '') {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'userId and amount are required' } });
      return;
    }

    const parsedAmount = parseFloat(String(amount));
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'amount must be a positive number' } });
      return;
    }

    const resolvedCurrency = currency.toUpperCase();

    // ← حذفنا deleted_at لأنه مش موجود في الـ schema
    let wallet = await prisma.wallet.findFirst({
      where: { user_id: userId, currency: resolvedCurrency },
    });

    if (!wallet) {
      const primaryExists = await prisma.wallet.findFirst({
        where: { user_id: userId, is_primary: true },
      });
      wallet = await prisma.wallet.create({
        data: {
          user_id:     userId,
          wallet_type: 'internal',
          currency:    resolvedCurrency,
          balance:     0,
          is_primary:  !primaryExists,
        },
      });
    }

    const walletId       = wallet.id;
    const previousBalance = Number(wallet.balance); // ← Decimal → number

    const updatedWallet = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await writeAuditLog(tx, {
        action: 'deposit', entity: 'wallet', entityId: walletId, userId,
        before: { balance: previousBalance },
        after:  { balance: previousBalance + parsedAmount },
        metadata: { referenceId, source: 'payment-service' },
      });

      const updated = await tx.wallet.update({
        where: { id: walletId },
        data:  { balance: { increment: parsedAmount } },
      });

      await tx.transaction.create({
        data: {
          wallet_id:   walletId,
          type:        'deposit',
          amount:      parsedAmount,
          currency:    resolvedCurrency, // ← أضفناه
          asset_type:  resolvedCurrency,
          status:      'completed',
          description: 'Payment credit (Pi → TEC conversion)',
          metadata:    { referenceId, source: 'payment-service' },
        },
      });

      return updated;
    });

    res.json({ success: true, data: { balance: updatedWallet.balance } });
  } catch (error) {
    logger.error('AddFundsInternal error', { error: (error as Error).message });
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to add funds' } });
  }
};
