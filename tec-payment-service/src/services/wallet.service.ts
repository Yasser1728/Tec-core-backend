/**
 * ── TEC Wallet Service ──
 *
 * Handles crediting TEC tokens after Pi payments
 */

import { logInfo, logWarn, logError } from '../utils/logger';
import { env } from '../config/env';

const TEC_CONVERSION_RATE = 0.1; // 1 Pi = 0.1 TEC
const WALLET_SERVICE_URL = env.WALLET_SERVICE_URL ?? 'http://localhost:5002';
const WALLET_INTERNAL_SECRET = env.INTERNAL_SECRET;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithTimeout = async (url: string, options: RequestInit, timeout = 5000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const creditTecWallet = async (
  userId: string,
  piAmount: number,
  referenceId: string,
  requestId?: string
) => {
  const tecAmount = piAmount * TEC_CONVERSION_RATE;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WALLET_INTERNAL_SECRET) headers['x-internal-key'] = WALLET_INTERNAL_SECRET;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      logInfo('Crediting TEC wallet', { userId, piAmount, tecAmount, referenceId, requestId, attempt });

      const res = await fetchWithTimeout(
        `${WALLET_SERVICE_URL}/wallets/internal/add-funds`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ userId, amount: tecAmount, currency: 'TEC', referenceId }),
        },
        5000
      );

      if (res.ok) {
        logInfo('TEC wallet credited successfully', { userId, tecAmount, referenceId });
        return;
      }

      const body = await res.text().catch(() => '');
      logWarn('TEC wallet credit failed — retrying', { userId, attempt, status: res.status, body });
    } catch (err) {
      logWarn('TEC wallet network error — retrying', { userId, attempt, error: (err as Error).message });
    }

    await sleep(500 * 2 ** (attempt - 1));
  }

  logError('TEC wallet credit failed after retries — manual review required', { userId, piAmount, tecAmount, referenceId });
};
