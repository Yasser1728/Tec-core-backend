import Redis from 'ioredis';

const getRedisUrl = (): string => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL environment variable is required');
  return url;
};

export const createSubscriber = (): Redis => {
  return new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });
};

export const EVENTS = {
  PAYMENT_COMPLETED: 'payment.completed',
} as const;

export interface PaymentCompletedEvent {
  paymentId: string;
  userId: string;
  amount: number;
  currency: string;
  piPaymentId: string;
  timestamp: string;
}

export const subscribeEvent = (
  subscriber: Redis,
  channel: string,
  handler: (payload: any) => Promise<void>
): void => {
  subscriber.subscribe(channel, (err) => {
    if (err) {
      console.error(`[EventBus] Subscribe error: ${channel}`, err);
      return;
    }
    console.log(`[EventBus] Subscribed to: ${channel}`);
  });

  subscriber.on('message', async (receivedChannel, message) => {
    if (receivedChannel !== channel) return;
    try {
      const payload = JSON.parse(message);
      await handler(payload);
    } catch (err) {
      console.error(`[EventBus] Handler error: ${channel}`, err);
    }
  });
};
