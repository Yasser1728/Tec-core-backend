// tec-wallet-service/src/wallet/wallet.service.ts

import { PrismaClient, Wallet } from '../../prisma/client';
import { PaymentCompletedEvent } from '../event-bus';

export class WalletService {
  constructor(private readonly prisma: PrismaClient) {}

  // ────────────────────────────────────────────────────────────
  // handlePaymentCompleted
  // الدالة الرئيسية — بتُعالج payment.completed event
  // ────────────────────────────────────────────────────────────
  async handlePaymentCompleted(event: PaymentCompletedEvent): Promise<void> {
    const { paymentId, userId, amount, currency, piPaymentId, timestamp } = event;

    // ── Validate ──────────────────────────────────────────────
    if (!paymentId || !userId) {
      throw new Error('Invalid event: missing paymentId or userId');
    }
    if (amount <= 0) {
      throw new Error('Invalid amount: must be greater than zero');
    }

    const idempotencyKey = `payment:${paymentId}`;

    // ── Atomic: Idempotency + Credit + Ledger + Audit ─────────
    await this.prisma.$transaction(async (tx) => {

      // 1. Idempotency check داخل الـ transaction (يمنع race condition)
      const existing = await tx.processedEvent.findUnique({
        where: { event_key: idempotencyKey },
      });
      if (existing) {
        // سبق معالجته — نخرج بهدوء بدون error
        return;
      }

      // 2. سجِّل الـ event فوراً (يمنع أي consumer تاني يعالجه)
      await tx.processedEvent.create({
        data: {
          event_key:    idempotencyKey,
          user_id:      userId,
          processed_at: new Date(),
        },
      });

      // 3. Find or create wallet
      const wallet = await this.findOrCreateWallet(tx, userId, currency);

      const balanceBefore = Number(wallet.balance);
      const balanceAfter  = balanceBefore + amount;

      // 4. Credit balance
      await tx.wallet.update({
        where: { id: wallet.id },
        data:  { balance: { increment: amount } },
      });

      // 5. Ledger entry
      await tx.transaction.create({
        data: {
          wallet_id:   wallet.id,
          type:        'CREDIT',
          amount,
          currency:    currency || 'PI',
          asset_type:  currency || 'PI',
          status:      'completed',
          description: idempotencyKey,
          payment_id:  paymentId,
          metadata: {
            paymentId,
            piPaymentId,
            userId,
            processedAt: timestamp,
          },
        },
      });

      // 6. Audit log
      await tx.auditLog.create({
        data: {
          action:    'credit',
          entity:    'wallet',
          entity_id: wallet.id,
          user_id:   userId,
          before:    { balance: balanceBefore },
          after:     { balance: balanceAfter },
          metadata: {
            paymentId,
            piPaymentId,
            source: 'payment.completed',
          },
        },
      });
    });
  }

  // ────────────────────────────────────────────────────────────
  // findOrCreateWallet — helper داخلي
  // ────────────────────────────────────────────────────────────
  private async findOrCreateWallet(
    tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    userId: string,
    currency: string,
  ): Promise<Wallet> {
    const existing = await tx.wallet.findFirst({
      where: {
        user_id:    userId,
        currency:   currency || 'PI',
        is_primary: true,
      },
    });

    if (existing) return existing;

    return tx.wallet.create({
      data: {
        user_id:     userId,
        wallet_type: 'pi',
        currency:    currency || 'PI',
        balance:     0,
        is_primary:  true,
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  // getBalance
  // ────────────────────────────────────────────────────────────
  async getBalance(userId: string, currency = 'PI'): Promise<number> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { user_id: userId, currency, is_primary: true },
    });
    return wallet ? Number(wallet.balance) : 0;
  }

  // ────────────────────────────────────────────────────────────
  // getTransactions
  // ────────────────────────────────────────────────────────────
  async getTransactions(
    userId: string,
    options: { page?: number; limit?: number } = {},
  ) {
    const { page = 1, limit = 10 } = options;

    const wallet = await this.prisma.wallet.findFirst({
      where: { user_id: userId, is_primary: true },
    });
    if (!wallet) return { transactions: [], total: 0 };

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where:   { wallet_id: wallet.id },
        orderBy: { created_at: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      this.prisma.transaction.count({
        where: { wallet_id: wallet.id },
      }),
    ]);

    return { transactions, total };
  }
          }
