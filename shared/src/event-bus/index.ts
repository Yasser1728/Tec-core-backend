import Redis from 'ioredis';
import pino  from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base:  { service: 'event-bus' },
});

const getRedisUrl = (): string => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL environment variable is required');
  return url;
};

export const EVENTS = {
  PAYMENT_COMPLETED: 'payment.completed',
} as const;

export interface PaymentCompletedEvent {
  paymentId:   string;
  userId:      string;
  amount:      number;
  currency:    string;
  piPaymentId: string;
  timestamp:   string;
}

export const createPublisher = (): Redis =>
  new Redis(getRedisUrl(), {
    maxRetriesPerRequest: 3,
    retryStrategy:        (times) => Math.min(times * 100, 3000),
    lazyConnect:          false,
    enableOfflineQueue:   true,
  });

export const createSubscriber = (): Redis =>
  new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null,
    retryStrategy:        (times) => Math.min(times * 100, 3000),
    lazyConnect:          false,
    enableOfflineQueue:   true,
  });

export const publishEvent = async (
  client:     Redis,
  streamName: string,
  payload:    object,
): Promise<string> => {
  const messageId = await client.xadd(
    streamName, '*',
    'data',      JSON.stringify(payload),
    'timestamp', Date.now().toString(),
  );
  if (!messageId) throw new Error(`Failed to publish to stream: ${streamName}`);
  logger.info({ streamName, messageId }, '[EventBus] Published');
  return messageId;
};

export const ensureConsumerGroup = async (
  client:     Redis,
  streamName: string,
  groupName:  string,
): Promise<void> => {
  try {
    await client.xgroup('CREATE', streamName, groupName, '$', 'MKSTREAM');
    logger.info({ groupName, streamName }, '[EventBus] Consumer group created');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message?.includes('BUSYGROUP')) throw err;
  }
};

const processPendingMessages = async (
  client:       Redis,
  streamName:   string,
  groupName:    string,
  consumerName: string,
  handler:      (payload: unknown) => Promise<void>,
): Promise<void> => {
  const pending = await client.xreadgroup(
    'GROUP', groupName, consumerName,
    'COUNT', 100,
    'STREAMS', streamName, '0',
  ) as unknown as Array<[string, Array<[string, string[]]>]> | null;

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
      } catch (err: unknown) {
        logger.error({ messageId, err }, '[EventBus] Pending message failed');
      }
    }
  }

  if (count > 0) logger.info({ count }, '[EventBus] Processed pending messages');
};

export const subscribeStream = async (
  client:       Redis,
  streamName:   string,
  groupName:    string,
  consumerName: string,
  handler:      (payload: unknown) => Promise<void>,
  options: {
    batchSize?:  number;
    blockMs?:    number;
    retryDelay?: number;
  } = {},
): Promise<void> => {
  const { batchSize = 10, blockMs = 5000, retryDelay = 1000 } = options;

  await ensureConsumerGroup(client, streamName, groupName);
  logger.info({ consumerName, streamName }, '[EventBus] Consumer started');
  await processPendingMessages(client, streamName, groupName, consumerName, handler);

  while (true) {
    try {
      const results = await client.xreadgroup(
        'GROUP', groupName, consumerName,
        'COUNT', batchSize,
        'BLOCK', blockMs,
        'STREAMS', streamName, '>',
      ) as unknown as Array<[string, Array<[string, string[]]>]> | null;

      if (!results) continue;

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages) {
          try {
            const dataIndex = fields.indexOf('data');
            if (dataIndex === -1) continue;
            const payload = JSON.parse(fields[dataIndex + 1]);
            await handler(payload);
            await client.xack(streamName, groupName, messageId);
            logger.info({ messageId }, '[EventBus] ACK');
          } catch (err: unknown) {
            logger.error({ messageId, err }, '[EventBus] Handler failed');
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('NOGROUP')) {
        await ensureConsumerGroup(client, streamName, groupName);
      } else {
        logger.error({ err }, '[EventBus] Stream read error');
        await new Promise(r => setTimeout(r, retryDelay));
      }
    }
  }
};
