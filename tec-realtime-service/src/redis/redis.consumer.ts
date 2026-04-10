import Redis            from 'ioredis';
import pino             from 'pino';
import { RealtimeGateway } from '../gateway/realtime.gateway';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'realtime-service' } });

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

const consumePaymentCompleted = async (client: Redis, gateway: RealtimeGateway): Promise<void> => {
  const STREAM = 'payment.completed', GROUP = 'realtime-service', CONSUMER = 'realtime-consumer-1';
  await ensureGroup(client, STREAM, GROUP);
  logger.info('[RealtimeConsumer] Listening for payment.completed...');

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
            gateway.emitToUser(payload.userId, 'wallet.updated', {
              paymentId: payload.paymentId,
              amount:    payload.amount,
              currency:  payload.currency,
              timestamp: payload.timestamp,
            });
            await client.xack(STREAM, GROUP, messageId);
            logger.info({ userId: payload.userId }, '[RealtimeConsumer] wallet.updated emitted');
          } catch (err: unknown) {
            logger.error({ messageId, err }, '[RealtimeConsumer] Handler failed');
          }
        }
      }
    } catch (err: unknown) {
      if (isShuttingDown) break;
      if (err instanceof Error && err.message?.includes('NOGROUP')) {
        await ensureGroup(client, STREAM, GROUP);
      } else {
        logger.error({ err }, '[RealtimeConsumer] Error');
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
};

const consumeUserCreated = async (client: Redis, gateway: RealtimeGateway): Promise<void> => {
  const STREAM = 'user.created', GROUP = 'realtime-service', CONSUMER = 'realtime-consumer-2';
  await ensureGroup(client, STREAM, GROUP);
  logger.info('[RealtimeConsumer] Listening for user.created...');

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
            gateway.emitToUser(payload.userId, 'notification.new', {
              type:      'SYSTEM',
              title:     '👋 Welcome to TEC!',
              message:   `Welcome ${payload.username}!`,
              timestamp: new Date().toISOString(),
            });
            await client.xack(STREAM, GROUP, messageId);
          } catch (err: unknown) {
            logger.error({ messageId, err }, '[RealtimeConsumer] Handler failed');
          }
        }
      }
    } catch (err: unknown) {
      if (isShuttingDown) break;
      if (err instanceof Error && err.message?.includes('NOGROUP')) {
        await ensureGroup(client, STREAM, GROUP);
      } else {
        logger.error({ err }, '[RealtimeConsumer] Error');
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
};

export const startRealtimeConsumers = async (gateway: RealtimeGateway): Promise<void> => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn('[RealtimeConsumer] REDIS_URL not set — disabled');
    return;
  }

  const client1 = createConsumer(redisUrl);
  const client2 = createConsumer(redisUrl);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, '[RealtimeConsumer] Shutting down...');
    isShuttingDown = true;
    await Promise.all([
      client1.quit().catch(() => client1.disconnect()),
      client2.quit().catch(() => client2.disconnect()),
    ]);
    logger.info('[RealtimeConsumer] Redis connections closed');
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT',  () => shutdown('SIGINT'));

  consumePaymentCompleted(client1, gateway).catch(err =>
    logger.error({ err }, '[RealtimeConsumer] payment.completed fatal')
  );
  consumeUserCreated(client2, gateway).catch(err =>
    logger.error({ err }, '[RealtimeConsumer] user.created fatal')
  );

  logger.info('Realtime Consumers started');
};
