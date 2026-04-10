import Redis              from 'ioredis';
import pino               from 'pino';
import { AnalyticsService } from './analytics.service';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'analytics-service' } });

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

const consumeStream = async (
  client:   Redis,
  stream:   string,
  group:    string,
  consumer: string,
  handler:  (payload: Record<string, unknown>) => Promise<void>,
): Promise<void> => {
  await ensureGroup(client, stream, group);
  logger.info({ stream }, '[AnalyticsConsumer] Listening...');

  while (!isShuttingDown) {
    try {
      const results = await client.xreadgroup('GROUP', group, consumer, 'COUNT', 10, 'BLOCK', 5000, 'STREAMS', stream, '>') as any;
      if (!results) continue;

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages) {
          try {
            const dataIndex = (fields as string[]).indexOf('data');
            if (dataIndex === -1) continue;
            const payload = JSON.parse((fields as string[])[dataIndex + 1]);
            await handler(payload);
            await client.xack(stream, group, messageId);
          } catch (err: unknown) {
            logger.error({ messageId, err }, '[AnalyticsConsumer] Handler failed');
          }
        }
      }
    } catch (err: unknown) {
      if (isShuttingDown) break;
      if (err instanceof Error && err.message?.includes('NOGROUP')) {
        await ensureGroup(client, stream, group);
      } else {
        logger.error({ stream, err }, '[AnalyticsConsumer] Error');
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
};

export const startAnalyticsConsumers = async (service: AnalyticsService): Promise<void> => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn('[AnalyticsConsumer] REDIS_URL not set — disabled');
    return;
  }

  const GROUP = 'analytics-service';
  const client1 = createConsumer(redisUrl);
  const client2 = createConsumer(redisUrl);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, '[AnalyticsConsumer] Shutting down...');
    isShuttingDown = true;
    await Promise.all([
      client1.quit().catch(() => client1.disconnect()),
      client2.quit().catch(() => client2.disconnect()),
    ]);
    logger.info('[AnalyticsConsumer] Redis connections closed');
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT',  () => shutdown('SIGINT'));

  consumeStream(client1, 'payment.completed', GROUP, 'analytics-consumer-1', async (payload) => {
    await service.trackEvent({ type: 'payment.completed', payload, userId: payload.userId as string });
    await service.updateDailyMetric({ date: new Date(), field: 'total_payments', value: 1 });
    await service.updateDailyMetric({ date: new Date(), field: 'total_volume',   value: payload.amount as number });
    logger.info('[AnalyticsConsumer] payment.completed tracked');
  }).catch(err => logger.error({ err }, '[AnalyticsConsumer] payment.completed fatal'));

  consumeStream(client2, 'user.created', GROUP, 'analytics-consumer-2', async (payload) => {
    await service.trackEvent({ type: 'user.created', payload, userId: payload.userId as string });
    await service.updateDailyMetric({ date: new Date(), field: 'new_users', value: 1 });
    logger.info('[AnalyticsConsumer] user.created tracked');
  }).catch(err => logger.error({ err }, '[AnalyticsConsumer] user.created fatal'));

  logger.info('Analytics Consumers started');
};
