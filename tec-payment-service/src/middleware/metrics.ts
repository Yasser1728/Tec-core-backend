/**
 * HTTP metrics middleware.
 *
 * Records per-request Prometheus metrics:
 *   - http_request_duration_seconds (histogram)
 *   - http_requests_total           (counter)
 *   - http_errors_total             (counter, only for 4xx/5xx)
 *
 * Labels: method, route, status_code.
 * The route label uses req.route.path when available (matched route pattern)
 * and falls back to req.path to avoid high-cardinality label explosions.
 */
import { Request, Response, NextFunction } from 'express';
import {
  httpRequestDuration,
  httpRequestCounter,
  errorCounter,
} from '../infra/metrics';

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1e9;
    const route = (req.route?.path as string | undefined) ?? req.path ?? 'unknown';
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestDuration.observe(labels, durationMs);
    httpRequestCounter.inc(labels);

    if (res.statusCode >= 400) {
      errorCounter.inc(labels);
    }
  });

  next();
};
