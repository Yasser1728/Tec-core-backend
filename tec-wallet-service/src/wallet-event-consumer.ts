import { PrismaClient } from '../prisma/client';
import {
  createSubscriber,
  subscribeEvent,
  EVENTS,
  PaymentCompletedEvent,
} from './event-bus';

const prisma = new PrismaClient();

const handlePaymentCompleted = async (event: PaymentCompletedEvent): Promise<void> => {
  const { paymentId, userId, amount, currency, piPaymentId, timestamp } = event;

  console.log('[WalletConsumer] Processing payment.completed:', { paymentId, userId, amount });

  const existingTransaction = await prisma.transaction.findFirst({
    where: { description: `payment:${paymentId}`, type: 'CREDIT' },
  });

  if (existingTransaction) {
    console.log('[WalletConsumer] Duplicate event ignored:', paymentId);
    return;
  }

  let wallet = await prisma.wallet.findFirst({
    where: { user_id: userId, currency: currency || 'PI', is_primary: true },
  });

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: {
        user_id: userId,
        wallet_type: 'pi',
        currency: currency || 'PI',
        balance: 0,
        is_primary: true,
      },
    });
    console.log('[WalletConsumer] Created new wallet for user:', userId);
  }

  await prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { id: wallet!.id },
      data: { balance: { increment: amount } },
    });

    await tx.transaction.create({
      data: {
        wallet_id: wallet!.id,
        type: 'CREDIT',
        amount,
        asset_type: currency || 'PI',
        status: 'completed',
        description: `payment:${paymentId}`,
        metadata: { paymentId, piPaymentId, userId, processedAt: timestamp },
      },
    });

    await tx.auditLog.create({
      data: {
        action: 'credit',
        entity: 'wallet',
        entity_id: wallet!.id,
        user_id: userId,
        before: { balance: wallet!.balance },
        after: { balance: wallet!.balance + amount },
        metadata: { paymentId, piPaymentId, source: 'payment.completed' },
      },
    });
  });

  console.log('[WalletConsumer] ✅ Wallet credited:', { userId, amount, walletId: wallet.id });
};

export const startWalletEventConsumer = (): void => {
  const subscriber = createSubscriber();
  subscribeEvent(subscriber, EVENTS.PAYMENT_COMPLETED, handlePaymentCompleted);
  console.log('[WalletConsumer] Started — listening for payment.completed');
};
