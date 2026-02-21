import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { prisma } from '../config/database';

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