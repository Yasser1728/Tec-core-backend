import { prisma } from '../config/database';
import { logInfo, logWarn } from '../utils/logger';
import { Prisma } from '@prisma/client';

export interface OutboxEventData {
  streamName: string;
  payload: Record<string, unknown>;
}

export const saveOutboxEvent = async (
  tx: Prisma.TransactionClient,
  data: OutboxEventData,
): Promise<void> => {
  await tx.outboxEvent.create({
    data: {
      stream_name: data.streamName,
      payload: data.payload as Prisma.InputJsonValue, // ✅ cast صح
      status: 'pending',
      next_retry: new Date(),
    },
  });

  logInfo('Outbox event saved', {
    streamName: data.streamName,
  });
};

export const saveOutboxEventDirect = async (
  data: OutboxEventData,
): Promise<void> => {
  await prisma.outboxEvent.create({
    data: {
      stream_name: data.streamName,
      payload: data.payload as Prisma.InputJsonValue, // ✅ cast صح
      status: 'pending',
      next_retry: new Date(),
    },
  });

  logInfo('Outbox event saved (direct)', {
    streamName: data.streamName,
  });
};

export const markEventPublished = async (id: string): Promise<void> => {
  await prisma.outboxEvent.update({
    where: { id },
    data: {
      status: 'published',
      published_at: new Date(),
    },
  });
};

export const markEventFailed = async (
  id: string,
  error: string,
  attempts: number,
  maxAttempts: number,
): Promise<void> => {
  const isFinal = attempts >= maxAttempts;
  const delayMs = Math.min(1000 * 2 ** attempts, 60000);
  const nextRetry = new Date(Date.now() + delayMs);

  await prisma.outboxEvent.update({
    where: { id },
    data: {
      status: isFinal ? 'failed' : 'pending',
      error,
      attempts: attempts + 1,
      next_retry: nextRetry,
    },
  });

  if (isFinal) {
    logWarn('Outbox event permanently failed', { id, error, attempts });
  }
};
