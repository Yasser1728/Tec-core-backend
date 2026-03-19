import { prisma } from '../config/database';
import { logInfo, logWarn } from '../utils/logger';

export interface OutboxEventData {
  streamName: string;
  payload: Record<string, unknown>;
}

// ✅ احفظ الـ event في الـ DB داخل نفس الـ transaction
export const saveOutboxEvent = async (
  tx: any,
  data: OutboxEventData,
): Promise<void> => {
  await tx.outboxEvent.create({
    data: {
      stream_name: data.streamName,
      payload: data.payload,
      status: 'pending',
      next_retry: new Date(),
    },
  });

  logInfo('Outbox event saved', {
    streamName: data.streamName,
    payload: data.payload,
  });
};

// ✅ احفظ الـ event خارج transaction (fallback)
export const saveOutboxEventDirect = async (
  data: OutboxEventData,
): Promise<void> => {
  await prisma.outboxEvent.create({
    data: {
      stream_name: data.streamName,
      payload: data.payload,
      status: 'pending',
      next_retry: new Date(),
    },
  });

  logInfo('Outbox event saved (direct)', {
    streamName: data.streamName,
  });
};

// ✅ جيب الـ pending events اللي جاهزة للإرسال
export const getPendingEvents = async (limit = 10) => {
  return prisma.outboxEvent.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
      attempts: { lt: prisma.outboxEvent.fields.max_attempts },
      next_retry: { lte: new Date() },
    },
    orderBy: { created_at: 'asc' },
    take: limit,
  });
};

// ✅ حدّث status لـ published
export const markEventPublished = async (id: string): Promise<void> => {
  await prisma.outboxEvent.update({
    where: { id },
    data: {
      status: 'published',
      published_at: new Date(),
    },
  });
};

// ✅ حدّث status لـ failed مع retry
export const markEventFailed = async (
  id: string,
  error: string,
  attempts: number,
  maxAttempts: number,
): Promise<void> => {
  const isFinal = attempts >= maxAttempts;

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s
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
