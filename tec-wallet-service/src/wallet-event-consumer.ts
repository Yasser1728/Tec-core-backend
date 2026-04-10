import pino                     from 'pino';
import { PrismaClient, Prisma } from '../prisma/client';
import {
  createSubscriber,
  subscribeStream,
  EVENTS,
  PaymentCompletedEvent,
} from './event-bus';
import { WalletService } from './wallet/wallet.service';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base:  { service: 'wallet-service' },
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _PrismaTx = Prisma.TransactionClient;

const prisma        = new PrismaClient();
const walletService = new WalletService(prisma);

const handlePaymentCompleted = async (payload: unknown): Promise<void> => {
  const event                  = payload as PaymentCompletedEvent;
  const { paymentId, userId, amount } = event;

  logger.info({ paymentId, userId, amount }, '[WalletConsumer] Processing payment.completed');

  await walletService.handlePaymentCompleted(event);

  logger.info({ paymentId, userId, amount }, '[WalletConsumer] Done');
};

export const startWalletEventConsumer = async (): Promise<void> => {
  const subscriber = createSubscriber();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, '[WalletConsumer] Shutting down...');
    try {
      await subscriber.quit();
    } catch {
      subscriber.disconnect();
    }
    await prisma.$disconnect();
    logger.info('[WalletConsumer] Redis + Prisma connections closed');
    process.exit(0);
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT',  () => { void shutdown('SIGINT'); });

  logger.info('[WalletConsumer] Starting — listening for payment.completed...');

  await subscribeStream(
    subscriber,
    EVENTS.PAYMENT_COMPLETED,
    'wallet-service',
    'wallet-consumer-1',
    handlePaymentCompleted,
    { batchSize: 10, blockMs: 5000, retryDelay: 1000 },
  );
};
