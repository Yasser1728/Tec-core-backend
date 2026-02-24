/**
 * Prometheus metrics registry for the Wallet Service.
 *
 * Exposes:
 *   - Default Node.js / process metrics (via collectDefaultMetrics)
 *   - http_request_duration_seconds  — histogram of request latency
 *   - http_requests_total            — counter of all HTTP requests
 *   - http_errors_total              — counter of 4xx/5xx responses
 */
import {
  Registry,
  Counter,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';

const SERVICE = process.env.SERVICE_NAME ?? 'wallet-service';

export const register = new Registry();
register.setDefaultLabels({ service: SERVICE });

collectDefaultMetrics({ register });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestCounter = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const errorCounter = new Counter({
  name: 'http_errors_total',
  help: 'Total number of HTTP error responses (4xx/5xx)',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});
