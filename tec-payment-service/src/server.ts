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
  } catch (err) {
    logError('❌ Payment Service failed to start:', { error: (err as Error).message });
    process.exit(1);
  }
}

main();
