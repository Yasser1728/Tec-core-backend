import Redis              from 'ioredis';
import pino               from 'pino';
import { IdentityService } from './identity.service';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'identity-service' } });

let isShuttingDown = false;

export const startUserCreatedConsumer = async (identityService: IdentityService): Promise<void> => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn('[UserCreatedConsumer] REDIS_URL not set — disabled');
    return;
  }

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => isShuttingDown ? null : Math.min(times * 100, 3000),
    enableOfflineQueue: true,
  });

  const STREAM = 'user.created', GROUP = 'identity-service', CONSUMER = 'identity-consumer-1';

  try {
    await client.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM');
    logger.info('[UserCreatedConsumer] Consumer group created');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message?.includes('BUSYGROUP')) throw err;
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, '[UserCreatedConsumer] Shutting down...');
    isShuttingDown = true;
    await client.quit().catch(() => client.disconnect());
    logger.info('[UserCreatedConsumer] Redis connection closed');
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT',  () => shutdown('SIGINT'));

  logger.info('[UserCreatedConsumer] Started — listening for user.created...');

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
            await identityService.findOrCreateUser({ piUserId: payload.piUserId, username: payload.username });
            await client.xack(STREAM, GROUP, messageId);
            logger.info({ username: payload.username }, '[UserCreatedConsumer] User synced');
          } catch (err: unknown) {
            logger.error({ messageId, err }, '[UserCreatedConsumer] Handler failed');
          }
        }
      }
    } catch (err: unknown) {
      if (isShuttingDown) break;
      if (err instanceof Error && err.message?.includes('NOGROUP')) {
        await client.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM').catch(() => {});
      } else {
        logger.error({ err }, '[UserCreatedConsumer] Error');
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
};
