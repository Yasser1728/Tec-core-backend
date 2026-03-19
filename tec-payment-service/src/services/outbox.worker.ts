// tec-payment-service/src/services/outbox.worker.ts

import { prisma } from '../config/database';
import { logInfo, logWarn, logError } from '../utils/logger';
import { markEventPublished, markEventFailed } from './outbox.service';

let isRunning = false;
let workerInterval: NodeJS.Timeout | null = null;

const processOutboxEvents = async (): Promise<void> => {
  if (isRunning) return;
  isRunning = true;

  try {
    // ✅ لو الـ table مش موجودة → مش هيـcrash
    const events = await prisma.outboxEvent.findMany({
      where: {
        status: { in: ['pending'] },
        next_retry: { lte: new Date() },
        attempts: { lt: 5 },
      },
      orderBy: { created_at: 'asc' },
      take: 10,
    }).catch((err) => {
      logWarn('[OutboxWorker] DB not ready yet', {
        error: (err as Error).message,
      });
      return [];
    });

    if (events.length === 0) {
      isRunning = false;
      return;
    }

    logInfo(`[OutboxWorker] Processing ${events.length} pending events`);

    for (const event of events) {
      try {
        const pub = (global as any).__redisPublisher;

        if (!pub) {
          logWarn('[OutboxWorker] Redis publisher not available — skipping');
          break;
        }

        // ✅ تحقق إن الـ connection جاهز
        if (pub.status !== 'ready') {
          logWarn('[OutboxWorker] Redis not ready — skipping', {
            status: pub.status,
          });
          break;
        }

        const messageId = await pub.xadd(
          event.stream_name,
          '*',
          'data', JSON.stringify(event.payload),
          'timestamp', Date.now().toString(),
          'outboxId', event.id,
        );

        await markEventPublished(event.id);

        logInfo('[OutboxWorker] Event published', {
          outboxId: event.id,
          streamName: event.stream_name,
          messageId,
        });

      } catch (err) {
        const error = (err as Error).message;
        logWarn('[OutboxWorker] Failed to publish event', {
          outboxId: event.id,
          error,
          attempts: event.attempts,
        });

        await markEventFailed(
          event.id,
          error,
          event.attempts,
          event.max_attempts,
        ).catch(() => {}); // ✅ مش بيوقف لو markEventFailed فشل
      }
    }
  } catch (err) {
    logError('[OutboxWorker] Fatal error', {
      error: (err as Error).message,
    });
  } finally {
    isRunning = false;
  }
};

export const startOutboxWorker = (): void => {
  const intervalMs = parseInt(
    process.env.OUTBOX_WORKER_INTERVAL_MS ?? '5000',
    10,
  );

  logInfo(`[OutboxWorker] Starting — polling every ${intervalMs}ms`);

  // ✅ أول run بعد 10 ثواني عشان الـ DB تبقى جاهزة
  setTimeout(() => {
    processOutboxEvents().catch((err) => {
      logError('[OutboxWorker] Startup processing failed', {
        error: (err as Error).message,
      });
    });
  }, 10000);

  workerInterval = setInterval(async () => {
    await processOutboxEvents().catch((err) => {
      logError('[OutboxWorker] Unhandled error', {
        error: (err as Error).message,
      });
    });
  }, intervalMs);
};

export const stopOutboxWorker = (): void => {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logInfo('[OutboxWorker] Stopped');
  }
};
