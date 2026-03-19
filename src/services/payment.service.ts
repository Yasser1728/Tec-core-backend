// shared/event-bus.ts

import Redis from 'ioredis';

const getRedisUrl = (): string => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL environment variable is required');
  return url;
};

// ─── Types ───────────────────────────────────────────────
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

// ─── Redis Clients ────────────────────────────────────────
export const createPublisher = (): Redis => {
  return new Redis(getRedisUrl(), {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    lazyConnect: true,
  });
};

export const createSubscriber = (): Redis => {
  return new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    lazyConnect: true,
  });
};

// ─── Publish (Redis Streams) ──────────────────────────────
export const publishEvent = async (
  client: Redis,
  streamName: string,
  payload: object
): Promise<string> => {
  // ✅ XADD → يحفظ الـ message في الـ stream
  const messageId = await client.xadd(
    streamName,
    '*',                        // auto-generate ID
    'data', JSON.stringify(payload),
    'timestamp', Date.now().toString(),
  );

  if (!messageId) throw new Error(`Failed to publish to stream: ${streamName}`);

  console.log(`[EventBus] Published to stream: ${streamName} id=${messageId}`);
  return messageId;
};

// ─── Consumer Group Setup ────────────────────────────────
export const ensureConsumerGroup = async (
  client: Redis,
  streamName: string,
  groupName: string,
): Promise<void> => {
  try {
    // $ = ابدأ من آخر message موجود
    await client.xgroup('CREATE', streamName, groupName, '$', 'MKSTREAM');
    console.log(`[EventBus] Consumer group created: ${groupName} on ${streamName}`);
  } catch (err: any) {
    // BUSYGROUP = الـ group موجود بالفعل = OK
    if (!err.message?.includes('BUSYGROUP')) {
      throw err;
    }
  }
};

// ─── Subscribe (Redis Streams) ───────────────────────────
export const subscribeStream = async (
  client: Redis,
  streamName: string,
  groupName: string,
  consumerName: string,
  handler: (payload: any) => Promise<void>,
  options: {
    batchSize?: number;
    blockMs?: number;
    retryDelay?: number;
  } = {}
): Promise<void> => {
  const {
    batchSize = 10,
    blockMs = 5000,
    retryDelay = 1000,
  } = options;

  await ensureConsumerGroup(client, streamName, groupName);

  console.log(`[EventBus] Starting consumer: ${consumerName} on ${streamName}`);

  // ─── Process pending messages أول (اللي اتقرأت بس مش اتعملت XACK)
  await processPendingMessages(client, streamName, groupName, consumerName, handler);

  // ─── Loop الأساسي
  while (true) {
    try {
      const results = await client.xreadgroup(
        'GROUP', groupName, consumerName,
        'COUNT', batchSize,
        'BLOCK', blockMs,
        'STREAMS', streamName,
        '>',  // فقط messages جديدة مش اتقرأت
      ) as any;

      if (!results) continue;  // timeout — عادي

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages) {
          try {
            const dataIndex = fields.indexOf('data');
            if (dataIndex === -1) continue;

            const payload = JSON.parse(fields[dataIndex + 1]);

            // ✅ بيعالج الـ message
            await handler(payload);

            // ✅ Acknowledge بعد ما الـ handler ينجح
            await client.xack(streamName, groupName, messageId);
            console.log(`[EventBus] ACK: ${messageId}`);

          } catch (err) {
            // ❌ لو الـ handler فشل → مش بيعمل XACK
            // = الـ message تفضل في الـ pending list
            // = هتتعالج تاني بعد الـ retry
            console.error(`[EventBus] Handler failed for ${messageId}:`, err);
          }
        }
      }
    } catch (err: any) {
      if (err.message?.includes('NOGROUP')) {
        await ensureConsumerGroup(client, streamName, groupName);
      } else {
        console.error('[EventBus] Stream read error:', err);
        await new Promise(r => setTimeout(r, retryDelay));
      }
    }
  }
};

// ─── Process Pending Messages ────────────────────────────
// اللي اتقرأت بس مش اتعملت XACK (عشان crash أو failure)
const processPendingMessages = async (
  client: Redis,
  streamName: string,
  groupName: string,
  consumerName: string,
  handler: (payload: any) => Promise<void>,
): Promise<void> => {
  const pending = await client.xreadgroup(
    'GROUP', groupName, consumerName,
    'COUNT', 100,
    'STREAMS', streamName,
    '0',  // 0 = اجيب الـ pending messages
  ) as any;

  if (!pending) return;

  let count = 0;
  for (const [, messages] of pending) {
    for (const [messageId, fields] of messages) {
      try {
        const dataIndex = fields.indexOf('data');
        if (dataIndex === -1) continue;

        const payload = JSON.parse(fields[dataIndex + 1]);
        await handler(payload);
        await client.xack(streamName, groupName, messageId);
        count++;
      } catch (err) {
        console.error(`[EventBus] Pending message failed ${messageId}:`, err);
      }
    }
  }

  if (count > 0) {
    console.log(`[EventBus] Processed ${count} pending messages`);
  }
};
