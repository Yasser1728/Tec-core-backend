import { logInfo, logWarn } from '../utils/logger';
import { publishEvent, createPublisher, EVENTS, PaymentCompletedEvent } from './event-bus';

// ─── Redis Publisher (singleton) ─────────────────────────
let publisher: ReturnType<typeof createPublisher> | null = null;

const getPublisher = async (): Promise<ReturnType<typeof createPublisher>> => {
  // ✅ استخدم الـ pre-initialized publisher من الـ startup
  if ((global as any).__redisPublisher) {
    return (global as any).__redisPublisher;
  }

  if (!publisher) {
    publisher = createPublisher();
    // ✅ انتظر الـ connection يبقى جاهز
    await new Promise<void>((resolve) => {
      if (publisher!.status === 'ready') {
        resolve();
      } else {
        publisher!.once('ready', resolve);
        publisher!.once('error', () => resolve()); // مش بنبلوك على الـ error
      }
    });
  }

  return publisher;
};

const getPiBaseUrl = (): string => {
  if (process.env.PI_PLATFORM_BASE_URL) return process.env.PI_PLATFORM_BASE_URL;
  return process.env.PI_SANDBOX === 'false'
    ? 'https://api.minepi.com'
    : 'https://api.sandbox.minepi.com';
};

const APPROVE_TIMEOUT = parseInt(process.env.PI_API_APPROVE_TIMEOUT ?? '30000', 10);
const COMPLETE_TIMEOUT = parseInt(process.env.PI_API_COMPLETE_TIMEOUT ?? '30000', 10);
const MAX_RETRIES = parseInt(process.env.PI_API_RETRIES ?? '3', 10);
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_TIMEOUT = 60000;

let circuitFailures = 0;
let circuitOpenUntil = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class PiApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 502,
  ) {
    super(message);
    this.name = 'PiApiError';
  }
}

const callPiApi = async (
  url: string,
  body?: Record<string, unknown>,
  timeout = 30000,
) => {
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
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (res.ok) {
        circuitFailures = 0;
        return res;
      }

      const text = await res.text().catch(() => '');
      logWarn('Pi API HTTP error', { url, status: res.status, attempt, body: text });

      if (res.status === 429 || res.status >= 500) {
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }

      throw new PiApiError(
        'PI_API_ERROR',
        `Pi API error (HTTP ${res.status})`,
        res.status,
      );

    } catch (err) {
      if (err instanceof PiApiError) throw err;
      if ((err as Error).name === 'AbortError') {
        logWarn('Pi API timeout', { url, attempt });
      } else {
        logWarn('Pi API network error', { url, attempt, error: (err as Error).message });
      }
      await sleep(500 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }

  circuitFailures++;
  if (circuitFailures >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_TIMEOUT;
    logWarn('Pi API circuit breaker triggered', {
      threshold: CIRCUIT_THRESHOLD,
      openUntil: circuitOpenUntil,
    });
  }

  throw new PiApiError('PI_RETRY_EXCEEDED', 'Pi API request failed after retries', 502);
};

export const piApprovePayment = async (piPaymentId: string): Promise<void> => {
  const url = `${getPiBaseUrl()}/v2/payments/${encodeURIComponent(piPaymentId)}/approve`;
  logInfo('Calling Pi API: approve', { piPaymentId });
  await callPiApi(url, undefined, APPROVE_TIMEOUT);
  logInfo('Pi API approve succeeded', { piPaymentId });
};

export const piCompletePayment = async (
  piPaymentId: string,
  txId?: string,
  eventData?: {
    paymentId: string;
    userId: string;
    amount: number;
    currency: string;
  },
): Promise<void> => {
  const url = `${getPiBaseUrl()}/v2/payments/${encodeURIComponent(piPaymentId)}/complete`;
  logInfo('Calling Pi API: complete', { piPaymentId, txId });
  await callPiApi(url, { txid: txId ?? '' }, COMPLETE_TIMEOUT);
  logInfo('Pi API complete succeeded', { piPaymentId, txId });

  // ✅ Emit event بعد complete ناجح
  if (eventData) {
    try {
      const event: PaymentCompletedEvent = {
        paymentId: eventData.paymentId,
        userId: eventData.userId,
        amount: eventData.amount,
        currency: eventData.currency,
        piPaymentId,
        timestamp: new Date().toISOString(),
      };

      // ✅ await getPublisher() — ينتظر الـ connection
      const pub = await getPublisher();
      const messageId = await publishEvent(pub, EVENTS.PAYMENT_COMPLETED, event);

      logInfo('payment.completed event emitted to stream', {
        ...event,
        messageId,
        stream: EVENTS.PAYMENT_COMPLETED,
      });

    } catch (err) {
      logWarn('Failed to emit payment.completed event', {
        error: (err as Error).message,
        paymentId: eventData.paymentId,
        userId: eventData.userId,
      });
    }
  }
};

export const _resetCircuitBreaker = (): void => {
  circuitFailures = 0;
  circuitOpenUntil = 0;
};
