import Redis                from 'ioredis';
import pino                 from 'pino';
import { NotificationService } from './notification.service';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'notification-service' } });

let isShuttingDown = false;

const createConsumer = (redisUrl: string): Redis =>
  new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => isShuttingDown ? null : Math.min(times * 100, 3000),
    enableOfflineQueue: true,
  });

const ensureGroup = async (client: Redis, stream: string, group: string): Promise<void> => {
  try {
    await client.xgroup('CREATE', stream, group, '$', 'MKSTREAM');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message?.includes('BUSYGROUP')) throw err;
  }
};

const consumePaymentCompleted = async (client: Redis, service: NotificationService): Promise<void> => {
  const STREAM = 'payment.completed', GROUP = 'notification-service', CONSUMER = 'notification-consumer-1';
  await ensureGroup(client, STREAM, GROUP);
  logger.info('[NotificationConsumer] Listening for payment.completed...');

  while (!isShuttingDown) {
    try {
      const results = await client.xreadgroup('GROUP', GROUP, CONSUMER, 'COUNT', 10, 'BLOCK', 5000, 'STREAMS', STREAM, '>') as any;
      if (!results) continue;

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages) {
          try {
            const dataIndex = (fields as string[]).indexOf('data');
            if (dataIndex === -1) continue;
            const payload = JSON.parse((fields as string[])[dataIndex + 1]);
            await service.create({
              userId:   payload.userId,
              type:     'PAYMENT',
              title:    '✅ Payment Successful',
              message:  `Your payment of ${payload.amount} ${payload.currency} was completed successfully.`,
              metadata: { paymentId: payload.paymentId, amount: payload.amount, currency: payload.currency },
            });
            await client.xack(STREAM, GROUP, messageId);
            logger.info({ userId: payload.userId }, '[NotificationConsumer] Payment notification sent');
          } catch (err: unknown) {
            logger.error({ messageId, err }, '[NotificationConsumer] Handler failed');
          }
        }
      }
    } catch (err: unknown) {
      if (isShuttingDown) break;
      if (err instanceof Error && err.message?.includes('NOGROUP')) {
        await ensureGroup(client, STREAM, GROUP);
      } else {
        logger.error({ err }, '[NotificationConsumer] Error');
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
};

const consumeUserCreated = async (client: Redis, service: NotificationService): Promise<void> => {
  const STREAM = 'user.created', GROUP = 'notification-service', CONSUMER = 'notification-consumer-2';
  await ensureGroup(client, STREAM, GROUP);
  logger.info('[NotificationConsumer] Listening for user.created...');

  while (!isShuttingDown) {
    try {
      const results = await client.xreadgroup('GROUP', GROUP, CONSUMER, 'COUNT', 10, 'BLOCK', 5000, 'STREAMS', STREAM, '>') as any;
      if (!results) continue;

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages) {
          try {
            const dataIndex = (fields as string[]).indexOf('data');
            if (dataIndex === -1) continue;
            const payload = JSON.parse((fields as string[])[dataIndex + 1]);
            await service.create({
              userId:   payload.userId,
              type:     'SYSTEM',
              title:    '👋 Welcome to TEC!',
              message:  `Welcome ${payload.username}! Your account has been created successfully.`,
              metadata: { username: payload.username },
            });
            await client.xack(STREAM, GROUP, messageId);
            logger.info({ username: payload.username }, '[NotificationConsumer] Welcome notification sent');
          } catch (err: unknown) {
            logger.error({ messageId, err }, '[NotificationConsumer] Handler failed');
          }
        }
      }
    } catch (err: unknown) {
      if (isShuttingDown) break;
      if (err instanceof Error && err.message?.includes('NOGROUP')) {
        await ensureGroup(client, STREAM, GROUP);
      } else {
        logger.error({ err }, '[NotificationConsumer] Error');
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
};

export const startNotificationConsumers = async (service: NotificationService): Promise<void> => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn('[NotificationConsumer] REDIS_URL not set — disabled');
    return;
  }

  const client1 = createConsumer(redisUrl);
  const client2 = createConsumer(redisUrl);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, '[NotificationConsumer] Shutting down...');
    isShuttingDown = true;
    await Promise.all([
      client1.quit().catch(() => client1.disconnect()),
      client2.quit().catch(() => client2.disconnect()),
    ]);
    logger.info('[NotificationConsumer] Redis connections closed');
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT',  () => shutdown('SIGINT'));

  consumePaymentCompleted(client1, service).catch(err =>
    logger.error({ err }, '[NotificationConsumer] payment.completed fatal')
  );
  consumeUserCreated(client2, service).catch(err =>
    logger.error({ err }, '[NotificationConsumer] user.created fatal')
  );

  logger.info('Notification Consumers started');
};
