/**
 * Payment service — Wallet Service integration.
 *
 * Handles the fire-and-forget HTTP call to `tec-wallet-service` that credits
 * TEC tokens to a user's wallet whenever a Pi payment is completed.
 *
 * Conversion rate: 1 Pi = 0.1 TEC
 *
 * The call is best-effort; failures are logged but do NOT surface to the caller
 * so that a transient wallet-service outage never blocks payment completion.
 */
import { logInfo, logWarn, logError } from '../utils/logger';
import { env } from '../config/env';

const TEC_CONVERSION_RATE = 0.1; // 1 Pi = 0.1 TEC

const getWalletServiceUrl = (): string =>
  env.WALLET_SERVICE_URL ?? 'http://localhost:5002';

/**
 * Credit TEC tokens to a user's wallet after a successful Pi payment.
 *
 * @param userId      - The user whose wallet should be credited.
 * @param piAmount    - The Pi amount from the completed payment.
 * @param referenceId - The payment ID used as a deduplication reference.
 * @param requestId   - Optional correlation ID for log tracing.
 */
export const creditTecWallet = async (
  userId: string,
  piAmount: number,
  referenceId: string,
  requestId?: string,
): Promise<void> => {
  const tecAmount = piAmount * TEC_CONVERSION_RATE;
  const walletServiceUrl = getWalletServiceUrl();
  const internalSecret = env.INTERNAL_SECRET;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (internalSecret) {
    headers['x-internal-key'] = internalSecret;
  }

  try {
    logInfo('Crediting TEC wallet', { userId, piAmount, tecAmount, referenceId, requestId });

    const response = await fetch(`${walletServiceUrl}/wallets/internal/add-funds`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userId,
        amount: tecAmount,
        currency: 'TEC',
        referenceId,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logWarn('Wallet TEC credit failed — needs manual review', {
        userId,
        piAmount,
        tecAmount,
        referenceId,
        requestId,
        status: response.status,
        body,
      });
    } else {
      logInfo(`Successfully credited ${tecAmount} TEC to user ${userId}`, {
        referenceId,
        requestId,
      });
    }
  } catch (err) {
    logError('Failed to credit TEC wallet — needs manual review', {
      userId,
      piAmount,
      tecAmount,
      referenceId,
      requestId,
      error: (err as Error).message,
    });
  }
};
