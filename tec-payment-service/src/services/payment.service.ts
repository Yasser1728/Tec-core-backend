/**
 * ── Pi Network Payment Service ──
 *
 * ✅ Production-ready for single-instance deployment
 *
 * Design Notes:
 * 1. Retry with exponential backoff handles transient API/network issues.
 * 2. Circuit breaker stops requests after 5 consecutive failures for 60s,
 *    preventing API flooding.
 * 3. Current implementation uses module-level variables for circuit state:
 *      let circuitFailures = 0;
 *      let circuitOpenUntil = 0;
 *    This is fine for single-instance deployments (typical Railway setup).
 * 4. ⚠️ If horizontal scaling (multiple instances) is used, each instance
 *    maintains its own circuit state. Shared state (e.g., Redis) would be
 *    required to enforce a global circuit breaker.
 *
 * Recommendation:
 * - Keep it simple for now: single-instance is stable and maintainable.
 * - Introduce Redis/shared state only if scaling requires it.
 */

import { logInfo, logWarn } from '../utils/logger';

const getPiBaseUrl = (): string => {
  if (process.env.PI_PLATFORM_BASE_URL) return process.env.PI_PLATFORM_BASE_URL;
  return process.env.PI_SANDBOX === 'false'
    ? 'https://api.minepi.com'
    : 'https://api.sandbox.minepi.com';
};

const APPROVE_TIMEOUT = parseInt(process.env.PI_API_APPROVE_TIMEOUT ?? '30000', 10);
const COMPLETE_TIMEOUT = parseInt(process.env.PI_API_COMPLETE_TIMEOUT ?? '30000', 10);
const MAX_RETRIES = parseInt(process.env.PI_API_RETRIES ?? '3', 10);
const CIRCUIT_THRESHOLD = 5;      // عدد محاولات الفشل قبل فتح الدائرة
const CIRCUIT_TIMEOUT = 60000;    // مدة فتح الدائرة 60 ثانية

/* =========================================================
   Circuit breaker state (module-level)
========================================================= */
let circuitFailures = 0;
let circuitOpenUntil = 0;

/* =========================================================
   Helpers
========================================================= */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class PiApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 502) {
    super(message);
    this.name = 'PiApiError';
  }
}

/* =========================================================
   Internal fetch with retry + exponential backoff + circuit breaker
========================================================= */
const callPiApi = async (url: string, body?: Record<string, unknown>, timeout = 30000) => {
  const apiKey = process.env.PI_API_KEY;
  if (!apiKey) throw new PiApiError('PI_CONFIG_ERROR', 'PI_API_KEY not configured', 500);

  const now = Date.now();
  if (circuitOpenUntil > now) {
    throw new PiApiError('PI_CIRCUIT_OPEN', 'Pi API circuit breaker is open', 503);
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (res.ok) {
        circuitFailures = 0; // reset failures on success
        return res;
      }

      const text = await res.text().catch(() => '');
      logWarn('Pi API HTTP error', { url, status: res.status, attempt, body: text });

      if (res.status === 429 || res.status >= 500) {
        await sleep(500 * 2 ** (attempt - 1)); // exponential backoff
        continue;
      }

      throw new PiApiError('PI_API_ERROR', `Pi API error (HTTP ${res.status})`, res.status);

    } catch (err) {
      if (err instanceof PiApiError) throw err;

      if ((err as Error).name === 'AbortError') {
        logWarn('Pi API timeout', { url, attempt });
      } else {
        logWarn('Pi API network error', { url, attempt, error: (err as Error).message });
      }

      await sleep(500 * 2 ** (attempt - 1)); // exponential backoff
    } finally {
      clearTimeout(timer);
    }
  }

  // circuit breaker logic
  circuitFailures++;
  if (circuitFailures >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_TIMEOUT;
    logWarn('Pi API circuit breaker triggered', { threshold: CIRCUIT_THRESHOLD, openUntil: circuitOpenUntil });
  }

  throw new PiApiError('PI_RETRY_EXCEEDED', 'Pi API request failed after retries', 502);
};

/* =========================================================
   Approve Payment
========================================================= */
export const piApprovePayment = async (piPaymentId: string): Promise<void> => {
  const url = `${getPiBaseUrl()}/v2/payments/${encodeURIComponent(piPaymentId)}/approve`;
  logInfo('Calling Pi API: approve', { piPaymentId });
  await callPiApi(url, undefined, APPROVE_TIMEOUT);
  logInfo('Pi API approve succeeded', { piPaymentId });
};

/* =========================================================
   Complete Payment
========================================================= */
export const piCompletePayment = async (piPaymentId: string, txId?: string): Promise<void> => {
  const url = `${getPiBaseUrl()}/v2/payments/${encodeURIComponent(piPaymentId)}/complete`;
  logInfo('Calling Pi API: complete', { piPaymentId, txId });
  await callPiApi(url, { txid: txId ?? '' }, COMPLETE_TIMEOUT);
  logInfo('Pi API complete succeeded', { piPaymentId, txId });
};

/* =========================================================
   Test Utilities (exported for testing only)
========================================================= */

/** @internal — use only in tests to reset circuit breaker state */
export const _resetCircuitBreaker = (): void => {
  circuitFailures = 0;
  circuitOpenUntil = 0;
};
