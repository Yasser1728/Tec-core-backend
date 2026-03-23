import { PrismaClient, Prisma } from '../prisma/client';
import {
  createSubscriber,
  subscribeStream,
  EVENTS,
  PaymentCompletedEvent,
} from './event-bus';
import { WalletService } from './wallet/wallet.service';

// ── Type للـ transaction client ──────────────────────────────
type PrismaTx = Prisma.TransactionClient;

const prisma        = new PrismaClient();
const walletService = new WalletService(prisma);

const handlePaymentCompleted = async (event: PaymentCompletedEvent): Promise<void> => {
  const { paymentId, userId, amount } = event;

  console.log('[WalletConsumer] Processing payment.completed:', {
    paymentId, userId, amount,
  });

  await walletService.handlePaymentCompleted(event);

  console.log('[WalletConsumer] ✅ Done:', { paymentId, userId, amount });
};

export const startWalletEventConsumer = async (): Promise<void> => {
  const subscriber = createSubscriber();

  console.log('[WalletConsumer] Starting — listening for payment.completed...');

  await subscribeStream(
    subscriber,
    EVENTS.PAYMENT_COMPLETED,
    'wallet-service',
    'wallet-consumer-1',
    handlePaymentCompleted,
    { batchSize: 10, blockMs: 5000, retryDelay: 1000 },
  );
};
