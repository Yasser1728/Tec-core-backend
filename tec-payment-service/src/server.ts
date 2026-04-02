import dotenv from 'dotenv';
dotenv.config();

if (process.env.NODE_ENV === 'production' && !process.env.INTERNAL_SECRET) {
  console.error('FATAL: INTERNAL_SECRET must be configured in production');
  process.exit(1);
}

async function main() {
  const { logInfo, logError } = await import('./utils/logger');
  try {
    const { default: app } = await import('./app');
    const { env } = await import('./config/env');

    // ✅ Initialize Redis publisher عند الـ startup
    if (process.env.REDIS_URL) {
      try {
        const { createPublisher } = await import('./services/event-bus');
        const publisher = createPublisher();
        publisher.on('connect', () => logInfo('✅ Redis publisher connected'));
        publisher.on('error', (err: Error) =>
          logInfo(`⚠️ Redis publisher error: ${err.message}`)
        );
        (global as any).__redisPublisher = publisher;
        logInfo('Redis publisher initialised');
      } catch (err) {
        logInfo(`⚠️ Redis publisher init failed: ${(err as Error).message}`);
      }
    }

    // ✅ Start Outbox Worker
    try {
      const { startOutboxWorker } = await import('./services/outbox.worker');
      startOutboxWorker();
      logInfo('✅ Outbox Worker started');
    } catch (err) {
      logError('⚠️ Outbox Worker failed to start', {
        error: (err as Error).message,
      });
    }

    const PORT = env.PORT;

    app.listen(PORT, () => {
      logInfo(`💳 Payment Service running on port ${PORT}`);
      if (!env.PI_API_KEY || !env.PI_APP_ID) {
        logInfo('⚠️ PI_API_KEY or PI_APP_ID not configured.');
      }
    });

    try {
      const cron = await import('node-cron');
      const RECONCILE_SCHEDULE = process.env.RECONCILE_CRON ?? '0 * * * *';

      cron.schedule(RECONCILE_SCHEDULE, async () => {
        try {
          logInfo('Running scheduled payment reconciliation...');
          const { reconcileStalePayments } = await import('./services/reconciliation.service');
          const result = await reconcileStalePayments();
          logInfo('Reconciliation complete', { result });
        } catch (cronErr) {
          logError('Reconciliation cron job failed', {
            error: (cronErr as Error).message,
          });
        }
      });

      logInfo(`Payment reconciliation cron scheduled: ${RECONCILE_SCHEDULE}`);
    } catch {
      logInfo('node-cron not available — reconciliation cron skipped');
    }

  } catch (err) {
    logError('❌ Payment Service failed to start:', {
      error: (err as Error).message,
    });
    process.exit(1);
  }
}

main();
