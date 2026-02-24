/**
 * Sentry error-tracking initialisation for the Payment Service.
 *
 * Call initSentry() once at application start-up (before routes/middleware).
 * Sentry is only activated when SENTRY_DSN is set and NODE_ENV is not
 * 'development' or 'test', so local development stays noise-free.
 *
 * Captured events:
 *   - Unhandled exceptions (via Sentry's default integration)
 *   - Unhandled promise rejections
 *   - Errors forwarded explicitly via Sentry.captureException(err)
 */
import * as Sentry from '@sentry/node';

let sentryInitialised = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  const environment = process.env.NODE_ENV ?? 'production';
  const serviceName = process.env.SERVICE_NAME ?? 'payment-service';

  // Disabled in local development / test to avoid noise.
  if (!dsn || environment === 'development' || environment === 'test') {
    return;
  }

  Sentry.init({
    dsn,
    environment,
    initialScope: {
      tags: { service: serviceName },
    },
    tracesSampleRate: 0.1,
  });

  // Capture unhandled promise rejections that may slip past Express.
  process.on('unhandledRejection', (reason) => {
    Sentry.captureException(reason);
  });

  sentryInitialised = true;
}

export function isSentryEnabled(): boolean {
  return sentryInitialised;
}

export { Sentry };
