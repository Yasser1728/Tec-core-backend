/**
 * Payment service — Pi Network API integration.
 *
 * Handles calls to the Pi Network payment API for the approve and complete
 * stages of the Pi payment lifecycle.  All credentials and timeouts are read
 * exclusively from environment variables (never hardcoded).
 *
 * Pi Network endpoints:
 *   Sandbox  (PI_SANDBOX=true, default): https://api.sandbox.minepi.com
 *   Mainnet  (PI_SANDBOX=false):         https://api.minepi.com
 *
 *   Approve: POST /v2/payments/:piPaymentId/approve
 *   Complete: POST /v2/payments/:piPaymentId/complete  { txid }
 */
import { logInfo, logWarn, logError } from '../utils/logger';

// ─── Pi API base URL ──────────────────────────────────────────────────────────

const getPiBaseUrl = (): string =>
  process.env.PI_SANDBOX === 'false'
    ? 'https://api.minepi.com'
    : 'https://api.sandbox.minepi.com';

// ─── Timeout helpers ──────────────────────────────────────────────────────────

const getApproveTimeoutMs = (): number =>
  parseInt(process.env.PI_API_APPROVE_TIMEOUT ?? '30000', 10);

const getCompleteTimeoutMs = (): number =>
  parseInt(process.env.PI_API_COMPLETE_TIMEOUT ?? '30000', 10);

// ─── Structured Pi error ──────────────────────────────────────────────────────

/** Thrown when the Pi Network API returns an error or times out. */
export class PiApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 502,
  ) {
    super(message);
    this.name = 'PiApiError';
  }
}

// ─── Pi API helpers ───────────────────────────────────────────────────────────

/**
 * Approve a Pi Network payment.
 * Calls POST /v2/payments/:piPaymentId/approve on the Pi Network API.
 *
 * @throws {PiApiError} on HTTP error, timeout, or network failure.
 */
export const piApprovePayment = async (piPaymentId: string): Promise<void> => {
  const apiKey = process.env.PI_API_KEY;
  if (!apiKey) {
    throw new PiApiError('PI_CONFIG_ERROR', 'PI_API_KEY is not configured', 500);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getApproveTimeoutMs());

  try {
    logInfo('Calling Pi API: approve', { piPaymentId });

    const res = await fetch(
      `${getPiBaseUrl()}/v2/payments/${encodeURIComponent(piPaymentId)}/approve`,
      {
        method: 'POST',
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logWarn('Pi API approve failed', { piPaymentId, status: res.status, body });
      throw new PiApiError(
        'PI_APPROVE_FAILED',
        `Pi Network approval failed (HTTP ${res.status})`,
        502,
      );
    }

    logInfo('Pi API approve succeeded', { piPaymentId });
  } catch (err) {
    if (err instanceof PiApiError) throw err;
    if ((err as Error).name === 'AbortError') {
      logWarn('Pi API approve timed out', { piPaymentId });
      throw new PiApiError('PI_TIMEOUT', 'Pi Network approve request timed out', 504);
    }
    logError('Pi API approve network error', { piPaymentId, error: (err as Error).message });
    throw new PiApiError('PI_NETWORK_ERROR', `Pi Network error: ${(err as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Complete a Pi Network payment.
 * Calls POST /v2/payments/:piPaymentId/complete on the Pi Network API.
 *
 * @param txId  Optional blockchain transaction ID supplied by the Pi SDK.
 * @throws {PiApiError} on HTTP error, timeout, or network failure.
 */
export const piCompletePayment = async (piPaymentId: string, txId?: string): Promise<void> => {
  const apiKey = process.env.PI_API_KEY;
  if (!apiKey) {
    throw new PiApiError('PI_CONFIG_ERROR', 'PI_API_KEY is not configured', 500);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getCompleteTimeoutMs());

  try {
    logInfo('Calling Pi API: complete', { piPaymentId, txId });

    const res = await fetch(
      `${getPiBaseUrl()}/v2/payments/${encodeURIComponent(piPaymentId)}/complete`,
      {
        method: 'POST',
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ txid: txId ?? '' }),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logWarn('Pi API complete failed', { piPaymentId, status: res.status, body });
      throw new PiApiError(
        'PI_COMPLETE_FAILED',
        `Pi Network completion failed (HTTP ${res.status})`,
        502,
      );
    }

    logInfo('Pi API complete succeeded', { piPaymentId, txId });
  } catch (err) {
    if (err instanceof PiApiError) throw err;
    if ((err as Error).name === 'AbortError') {
      logWarn('Pi API complete timed out', { piPaymentId });
      throw new PiApiError('PI_TIMEOUT', 'Pi Network complete request timed out', 504);
    }
    logError('Pi API complete network error', { piPaymentId, error: (err as Error).message });
    throw new PiApiError('PI_NETWORK_ERROR', `Pi Network error: ${(err as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }
};
