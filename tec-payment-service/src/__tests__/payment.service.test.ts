import { piApprovePayment, piCompletePayment, PiApiError, _resetCircuitBreaker } from '../services/payment.service';

jest.useFakeTimers();

global.fetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PI_API_KEY = 'dummy';
  _resetCircuitBreaker();
});

describe('Pi Service', () => {

  it('approves payment successfully', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true });
    await expect(piApprovePayment('payment123')).resolves.not.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('completes payment successfully', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true });
    await expect(piCompletePayment('payment123', 'tx456')).resolves.not.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('throws PiApiError on missing API key', async () => {
    process.env.PI_API_KEY = '';
    await expect(piApprovePayment('id')).rejects.toThrow(PiApiError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retries on network error and succeeds', async () => {
    let count = 0;
    (fetch as jest.Mock).mockImplementation(() => {
      if (++count < 3) throw new Error('Network');
      return Promise.resolve({ ok: true });
    });

    const promise = piApprovePayment('paymentRetry');
    await jest.runAllTimersAsync();
    await expect(promise).resolves.not.toThrow();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('throws after max retries exceeded', async () => {
    (fetch as jest.Mock).mockRejectedValue(new Error('Network'));

    const promise = piApprovePayment('fail');
    await jest.runAllTimersAsync();
    await expect(promise).rejects.toThrow(PiApiError);
  });

  it('does not retry on 4xx error', async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    await expect(piApprovePayment('bad')).rejects.toThrow(PiApiError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 server error', async () => {
    let count = 0;
    (fetch as jest.Mock).mockImplementation(() => {
      if (++count < 3) return Promise.resolve({ ok: false, status: 500, text: async () => '' });
      return Promise.resolve({ ok: true });
    });

    const promise = piApprovePayment('server-error');
    await jest.runAllTimersAsync();
    await expect(promise).resolves.not.toThrow();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries on 429 rate limit', async () => {
    let count = 0;
    (fetch as jest.Mock).mockImplementation(() => {
      if (++count < 2) return Promise.resolve({ ok: false, status: 429, text: async () => '' });
      return Promise.resolve({ ok: true });
    });

    const promise = piApprovePayment('rate-limit');
    await jest.runAllTimersAsync();
    await expect(promise).resolves.not.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('triggers circuit breaker after 5 failures', async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '',
    });

    for (let i = 0; i < 5; i++) {
      const promise = piApprovePayment('fail');
      await jest.runAllTimersAsync();
      await expect(promise).rejects.toThrow(PiApiError);
    }

    // Next call should be blocked by circuit breaker
    await expect(piApprovePayment('blocked')).rejects.toThrow('Pi API circuit breaker is open');
  });

});
