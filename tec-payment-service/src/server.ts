import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const { logInfo, logError } = await import('./utils/logger');
  try {
    const { default: app } = await import('./app');
    const { env } = await import('./config/env');

    const PORT = env.PORT;

    app.listen(PORT, () => {
      logInfo(`💳 Payment Service running on port ${PORT}`);
      if (!env.PI_API_KEY || !env.PI_APP_ID) {
        logInfo('⚠️  PI_API_KEY or PI_APP_ID not configured — Pi payment endpoints will return errors until set.');
      }
    });

    // ─── Payment Reconciliation Cron ─────────────────────────────────────────
    // Runs every hour to detect and resolve stale payments (created/approved
    // but never completed). Uses dynamic import to avoid loading the cron
    // library unless it is actually available.
    try {
      const cron = await import('node-cron');
      const RECONCILE_SCHEDULE = process.env.RECONCILE_CRON ?? '0 * * * *'; // every hour

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
    logError('❌ Payment Service failed to start:', { error: (err as Error).message });
    process.exit(1);
  }
}

main();
