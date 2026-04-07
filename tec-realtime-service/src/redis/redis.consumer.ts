import Redis from 'ioredis';
import { RealtimeGateway } from '../gateway/realtime.gateway';

// ── Graceful shutdown flag ─────────────────────────────────
let isShuttingDown = false;

const createConsumer = (redisUrl: string): Redis =>
  new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
      if (isShuttingDown) return null; // ✅ وقّف الـ retry عند الـ shutdown
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

// ✅ payment.completed → wallet.updated
const consumePaymentCompleted = async (
  client: Redis,
  gateway: RealtimeGateway,
): Promise<void> => {
  const STREAM   = 'payment.completed';
  const GROUP    = 'realtime-service';
  const CONSUMER = 'realtime-consumer-1';

  await ensureGroup(client, STREAM, GROUP);
  console.log('[RealtimeConsumer] Listening for payment.completed...');

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

            gateway.emitToUser(payload.userId, 'wallet.updated', {
              paymentId: payload.paymentId,
              amount:    payload.amount,
              currency:  payload.currency,
              timestamp: payload.timestamp,
            });

            await client.xack(STREAM, GROUP, messageId);
            console.log(`[RealtimeConsumer] ✅ wallet.updated → ${payload.userId}`);
          } catch (err) {
            console.error(`[RealtimeConsumer] Handler failed ${messageId}:`, err);
          }
        }
      }
    } catch (err: any) {
      if (isShuttingDown) break;
      if (err.message?.includes('NOGROUP')) {
        await ensureGroup(client, STREAM, GROUP);
      } else {
        console.error('[RealtimeConsumer] Error:', err.message);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
};

// ✅ user.created → welcome
const consumeUserCreated = async (
  client: Redis,
  gateway: RealtimeGateway,
): Promise<void> => {
  const STREAM   = 'user.created';
  const GROUP    = 'realtime-service';
  const CONSUMER = 'realtime-consumer-2';

  await ensureGroup(client, STREAM, GROUP);
  console.log('[RealtimeConsumer] Listening for user.created...');

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

            gateway.emitToUser(payload.userId, 'notification.new', {
              type:      'SYSTEM',
              title:     '👋 Welcome to TEC!',
              message:   `Welcome ${payload.username}!`,
              timestamp: new Date().toISOString(),
            });

            await client.xack(STREAM, GROUP, messageId);
          } catch (err) {
            console.error(`[RealtimeConsumer] Handler failed ${messageId}:`, err);
          }
        }
      }
    } catch (err: any) {
      if (isShuttingDown) break;
      if (err.message?.includes('NOGROUP')) {
        await ensureGroup(client, STREAM, GROUP);
      } else {
        console.error('[RealtimeConsumer] Error:', err.message);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
};

// ✅ Start all consumers + graceful shutdown
export const startRealtimeConsumers = async (
  gateway: RealtimeGateway,
): Promise<void> => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[RealtimeConsumer] REDIS_URL not set — disabled');
    return;
  }

  const client1 = createConsumer(redisUrl);
  const client2 = createConsumer(redisUrl);

  // ── Graceful shutdown handler ──────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`[RealtimeConsumer] ${signal} received — shutting down...`);
    isShuttingDown = true;
    await Promise.all([
      client1.quit().catch(() => client1.disconnect()),
      client2.quit().catch(() => client2.disconnect()),
    ]);
    console.log('[RealtimeConsumer] ✅ Redis connections closed');
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT',  () => shutdown('SIGINT'));

  consumePaymentCompleted(client1, gateway).catch((err) =>
    console.error('[RealtimeConsumer] payment.completed fatal:', err.message)
  );

  consumeUserCreated(client2, gateway).catch((err) =>
    console.error('[RealtimeConsumer] user.created fatal:', err.message)
  );

  console.log('✅ Realtime Consumers started');
};
