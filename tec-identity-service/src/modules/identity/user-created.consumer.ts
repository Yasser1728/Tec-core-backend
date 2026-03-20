import Redis from 'ioredis';
import { IdentityService } from './identity.service';

export const startUserCreatedConsumer = async (
  identityService: IdentityService,
): Promise<void> => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[UserCreatedConsumer] REDIS_URL not set — disabled');
    return;
  }

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    enableOfflineQueue: true,
  });

  const STREAM = 'user.created';
  const GROUP = 'identity-service';
  const CONSUMER = 'identity-consumer-1';

  try {
    await client.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM');
    console.log('[UserCreatedConsumer] Consumer group created');
  } catch (err: any) {
    if (!err.message?.includes('BUSYGROUP')) throw err;
  }

  console.log('[UserCreatedConsumer] Started — listening for user.created...');

  while (true) {
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
            await identityService.findOrCreateUser({
              piUserId: payload.piUserId,
              username: payload.username,
            });
            await client.xack(STREAM, GROUP, messageId);
            console.log(`[UserCreatedConsumer] ✅ User synced: ${payload.username}`);
          } catch (err) {
            console.error(`[UserCreatedConsumer] Handler failed ${messageId}:`, err);
          }
        }
      }
    } catch (err: any) {
      if (err.message?.includes('NOGROUP')) {
        await client.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM').catch(() => {});
      } else {
        console.error('[UserCreatedConsumer] Error:', err.message);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
};
