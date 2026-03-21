import Redis from 'ioredis';
import { AnalyticsService } from './analytics.service';

const createConsumer = (redisUrl: string): Redis =>
  new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 100, 3000),
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

const consumeStream = async (
  client: Redis,
  stream: string,
  group: string,
  consumer: string,
  handler: (payload: Record<string, unknown>) => Promise<void>,
): Promise<void> => {
  await ensureGroup(client, stream, group);
  console.log(`[AnalyticsConsumer] Listening for ${stream}...`);

  while (true) {
    try {
      const results = await client.xreadgroup(
        'GROUP', group, consumer,
        'COUNT', 10,
        'BLOCK', 5000,
        'STREAMS', stream,
        '>',
      ) as any;

      if (!results) continue;

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages) {
          try {
            const dataIndex = fields.indexOf('data');
            if (dataIndex === -1) continue;
            const payload = JSON.parse(fields[dataIndex + 1]);
            await handler(payload);
            await client.xack(stream, group, messageId);
          } catch (err) {
            console.error(`[AnalyticsConsumer] Handler failed ${messageId}:`, err);
          }
        }
      }
    } catch (err: any) {
      if (err.message?.includes('NOGROUP')) {
        await ensureGroup(client, stream, group);
      } else {
        console.error(`[AnalyticsConsumer] Error on ${stream}:`, err.message);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
};

export const startAnalyticsConsumers = async (
  service: AnalyticsService,
): Promise<void> => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[AnalyticsConsumer] REDIS_URL not set — disabled');
    return;
  }

  const GROUP = 'analytics-service';

  // ✅ payment.completed
  consumeStream(
    createConsumer(redisUrl),
    'payment.completed',
    GROUP,
    'analytics-consumer-1',
    async (payload) => {
      await service.trackEvent({
        type: 'payment.completed',
        payload,
        userId: payload.userId as string,
      });
      await service.updateDailyMetric({
        date: new Date(),
        field: 'total_payments',
        value: 1,
      });
      await service.updateDailyMetric({
        date: new Date(),
        field: 'total_volume',
        value: payload.amount as number,
      });
      console.log(`[AnalyticsConsumer] ✅ payment.completed tracked`);
    },
  ).catch(err => console.error('[AnalyticsConsumer] payment.completed fatal:', err.message));

  // ✅ user.created
  consumeStream(
    createConsumer(redisUrl),
    'user.created',
    GROUP,
    'analytics-consumer-2',
    async (payload) => {
      await service.trackEvent({
        type: 'user.created',
        payload,
        userId: payload.userId as string,
      });
      await service.updateDailyMetric({
        date: new Date(),
        field: 'new_users',
        value: 1,
      });
      console.log(`[AnalyticsConsumer] ✅ user.created tracked`);
    },
  ).catch(err => console.error('[AnalyticsConsumer] user.created fatal:', err.message));

  console.log('✅ Analytics Consumers started');
};
