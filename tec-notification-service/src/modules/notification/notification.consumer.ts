import Redis from 'ioredis';
import { NotificationService } from './notification.service';

// ── Graceful shutdown flag ─────────────────────────────────
let isShuttingDown = false;

const createConsumer = (redisUrl: string): Redis =>
  new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
      if (isShuttingDown) return null;
      return Math.min(times * 100, 3000);
    },
    enableOfflineQueue: true,
  });

const ensureGroup = async (
  client: Redis,
  stream: string,
  group: string,
): Promise<void> => {
  try {
    await client.xgroup('CREATE', stream, group, '$', 'MKSTREAM');
  } catch (err: any) {
    if (!err.message?.includes('BUSYGROUP')) throw err;
  }
};

// ✅ payment.completed → notification
const consumePaymentCompleted = async (
  client: Redis,
  service: NotificationService,
): Promise<void> => {
  const STREAM   = 'payment.completed';
  const GROUP    = 'notification-service';
  const CONSUMER = 'notification-consumer-1';

  await ensureGroup(client, STREAM, GROUP);
  console.log('[NotificationConsumer] Listening for payment.completed...');

  while (!isShuttingDown) {
    try {
      const results = await client.xreadgroup(
        'GROUP', GROUP, CONSUMER,
        'COUNT', 10,
        'BLOCK', 5000,
        'STREAMS', STREAM,
        '>',
      ) as any;

      if (!results) continue;

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages) {
          try {
            const dataIndex = fields.indexOf('data');
            if (dataIndex === -1) continue;

            const payload = JSON.parse(fields[dataIndex + 1]);

            await service.create({
              userId:  payload.userId,
              type:    'PAYMENT',
              title:   '✅ Payment Successful',
              message: `Your payment of ${payload.amount} ${payload.currency} was completed successfully.`,
              metadata: {
                paymentId: payload.paymentId,
                amount:    payload.amount,
                currency:  payload.currency,
              },
            });

            await client.xack(STREAM, GROUP, messageId);
            console.log(`[NotificationConsumer] ✅ Payment notification → ${payload.userId}`);
          } catch (err) {
            console.error(`[NotificationConsumer] Handler failed ${messageId}:`, err);
          }
        }
      }
    } catch (err: any) {
      if (isShuttingDown) break;
      if (err.message?.includes('NOGROUP')) {
        await ensureGroup(client, STREAM, GROUP);
      } else {
        console.error('[NotificationConsumer] Error:', err.message);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
};

// ✅ user.created → welcome notification
const consumeUserCreated = async (
  client: Redis,
  service: NotificationService,
): Promise<void> => {
  const STREAM   = 'user.created';
  const GROUP    = 'notification-service';
  const CONSUMER = 'notification-consumer-2';

  await ensureGroup(client, STREAM, GROUP);
  console.log('[NotificationConsumer] Listening for user.created...');

  while (!isShuttingDown) {
    try {
      const results = await client.xreadgroup(
        'GROUP', GROUP, CONSUMER,
        'COUNT', 10,
        'BLOCK', 5000,
        'STREAMS', STREAM,
        '>',
      ) as any;

      if (!results) continue;

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages) {
          try {
            const dataIndex = fields.indexOf('data');
            if (dataIndex === -1) continue;

            const payload = JSON.parse(fields[dataIndex + 1]);

            await service.create({
              userId:   payload.userId,
              type:     'SYSTEM',
              title:    '👋 Welcome to TEC!',
              message:  `Welcome ${payload.username}! Your account has been created successfully.`,
              metadata: { username: payload.username },
            });

            await client.xack(STREAM, GROUP, messageId);
            console.log(`[NotificationConsumer] ✅ Welcome notification → ${payload.username}`);
          } catch (err) {
            console.error(`[NotificationConsumer] Handler failed ${messageId}:`, err);
          }
        }
      }
    } catch (err: any) {
      if (isShuttingDown) break;
      if (err.message?.includes('NOGROUP')) {
        await ensureGroup(client, STREAM, GROUP);
      } else {
        console.error('[NotificationConsumer] Error:', err.message);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
};

// ✅ Start all consumers + graceful shutdown
export const startNotificationConsumers = async (
  service: NotificationService,
): Promise<void> => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[NotificationConsumer] REDIS_URL not set — disabled');
    return;
  }

  const client1 = createConsumer(redisUrl);
  const client2 = createConsumer(redisUrl);

  // ── Graceful shutdown handler ──────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`[NotificationConsumer] ${signal} received — shutting down...`);
    isShuttingDown = true;
    await Promise.all([
      client1.quit().catch(() => client1.disconnect()),
      client2.quit().catch(() => client2.disconnect()),
    ]);
    console.log('[NotificationConsumer] ✅ Redis connections closed');
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT',  () => shutdown('SIGINT'));

  consumePaymentCompleted(client1, service).catch((err) =>
    console.error('[NotificationConsumer] payment.completed fatal:', err.message)
  );

  consumeUserCreated(client2, service).catch((err) =>
    console.error('[NotificationConsumer] user.created fatal:', err.message)
  );

  console.log('✅ Notification Consumers started');
};
