import * as Sentry from '@sentry/node';

let sentryInitialised = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  const environment = process.env.NODE_ENV ?? 'production';
  const serviceName = process.env.SERVICE_NAME ?? 'payment-service';
  const release = process.env.SERVICE_VERSION ?? '1.0.0';

  if (!dsn || environment === 'development' || environment === 'test') {
    return;
  }

  Sentry.init({
    dsn,
    environment,
    release: `${serviceName}@${release}`,
    initialScope: {
      tags: { service: serviceName },
    },
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    // ✅ أضفنا
    integrations: [
      Sentry.extraErrorDataIntegration(),
    ],
    beforeSend(event) {
      // ✅ امسح أي sensitive data
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['x-internal-key'];
      }
      return event;
    },
  });

  // ✅ Capture unhandled rejections
  process.on('unhandledRejection', (reason) => {
    Sentry.captureException(reason);
  });

  // ✅ Capture uncaught exceptions
  process.on('uncaughtException', (error) => {
    Sentry.captureException(error);
    process.exit(1);
  });

  sentryInitialised = true;
  console.log(`[Sentry] Initialised for ${serviceName} (${environment})`);
}

export function captureError(
  error: Error,
  context?: Record<string, unknown>,
): void {
  if (!sentryInitialised) return;
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(error);
  });
}

export function isSentryEnabled(): boolean {
  return sentryInitialised;
}

export { Sentry };
