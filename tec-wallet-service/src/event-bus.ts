// tec-wallet-service/src/event-bus.ts

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
  payload: object,
): Promise<string> => {
  const messageId = await client.xadd(
    streamName,
    '*',
    'data', JSON.stringify(payload),
    'timestamp', Date.now().toString(),
  );

  if (!messageId) throw new Error(`Failed to publish to stream: ${streamName}`);
  console.log(`[EventBus] Published: ${streamName} id=${messageId}`);
  return messageId;
};

// ─── Consumer Group Setup ────────────────────────────────
export const ensureConsumerGroup = async (
  client: Redis,
  streamName: string,
  groupName: string,
): Promise<void> => {
  try {
    await client.xgroup('CREATE', streamName, groupName, '$', 'MKSTREAM');
    console.log(`[EventBus] Consumer group created: ${groupName}`);
  } catch (err: any) {
    if (!err.message?.includes('BUSYGROUP')) throw err;
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
  } = {},
): Promise<void> => {
  const { batchSize = 10, blockMs = 5000, retryDelay = 1000 } = options;

  await ensureConsumerGroup(client, streamName, groupName);

  console.log(`[EventBus] Consumer started: ${consumerName} on ${streamName}`);

  // ─── Process pending messages أول
  await processPendingMessages(client, streamName, groupName, consumerName, handler);

  // ─── Main loop
  while (true) {
    try {
      const results = await client.xreadgroup(
        'GROUP', groupName, consumerName,
        'COUNT', batchSize,
        'BLOCK', blockMs,
        'STREAMS', streamName,
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
            await client.xack(streamName, groupName, messageId);
            console.log(`[EventBus] ACK: ${messageId}`);
          } catch (err) {
            console.error(`[EventBus] Handler failed ${messageId}:`, err);
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
    '0',
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
        console.error(`[EventBus] Pending failed ${messageId}:`, err);
      }
    }
  }

  if (count > 0) {
    console.log(`[EventBus] Processed ${count} pending messages`);
  }
};
