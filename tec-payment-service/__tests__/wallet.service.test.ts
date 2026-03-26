import { creditTecWallet } from '../src/services/wallet.service';

jest.useFakeTimers();
global.fetch = jest.fn();

jest.mock('../src/utils/logger', () => ({
  logInfo:  jest.fn(),
  logWarn:  jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../src/config/env', () => ({
  env: {
    WALLET_SERVICE_URL: 'http://localhost:5002',
    INTERNAL_SECRET:    'test-secret',
  },
}));

beforeEach(() => jest.clearAllMocks());

describe('WalletService', () => {

  it('credits wallet successfully', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true });
    await expect(
      creditTecWallet('user-1', 1, 'ref-123'),
    ).resolves.not.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    let count = 0;
    (fetch as jest.Mock).mockImplementation(() => {
      if (++count < 3) return Promise.resolve({ ok: false, status: 500, text: async () => '' });
      return Promise.resolve({ ok: true });
    });

    const promise = creditTecWallet('user-1', 1, 'ref-retry');
    await jest.runAllTimersAsync();
    await expect(promise).resolves.not.toThrow();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('logs error after all retries exhausted', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    const { logError } = require('../src/utils/logger');

    const promise = creditTecWallet('user-1', 1, 'ref-fail');
    await jest.runAllTimersAsync();
    await promise;

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('manual review'),
      expect.any(Object),
    );
  });

  it('sends correct headers including internal key', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true });
    await creditTecWallet('user-1', 1, 'ref-123');
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-internal-key': 'test-secret',
        }),
      }),
    );
  });

  it('converts Pi amount to TEC correctly (1 Pi = 0.1 TEC)', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true });
    await creditTecWallet('user-1', 10, 'ref-123');
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          userId:      'user-1',
          amount:      1,     // 10 * 0.1
          currency:    'TEC',
          referenceId: 'ref-123',
        }),
      }),
    );
  });
});
