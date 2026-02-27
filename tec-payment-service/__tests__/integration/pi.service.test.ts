/**
 * Unit tests for tec-payment-service Pi Network service functions.
 *
 * All calls to the Pi Network API are intercepted via a `global.fetch` mock so
 * that no real HTTP requests are made during testing.
 */
import { piApprovePayment, piCompletePayment, PiApiError } from '../../src/services/payment.service';

const TEST_PI_PAYMENT_ID = 'pi_test_payment_abc123';
const TEST_TX_ID = 'txid_blockchain_abc123';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockFetchOk = (): void => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: jest.fn().mockResolvedValue('{"status":"approved"}'),
    json: jest.fn().mockResolvedValue({ status: 'approved' }),
  } as unknown as Response);
};

const mockFetchError = (status: number, body = ''): void => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    text: jest.fn().mockResolvedValue(body),
  } as unknown as Response);
};

const mockFetchNetworkError = (message = 'Network failure'): void => {
  global.fetch = jest.fn().mockRejectedValue(new Error(message));
};

const mockFetchAbort = (): void => {
  global.fetch = jest.fn().mockRejectedValue(
    Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
  );
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PI_API_KEY = 'test-pi-api-key';
  process.env.PI_APP_ID = 'test-pi-app-id';
  process.env.PI_SANDBOX = 'true';
  delete process.env.PI_API_APPROVE_TIMEOUT;
  delete process.env.PI_API_COMPLETE_TIMEOUT;
});

// ─── piApprovePayment ─────────────────────────────────────────────────────────

describe('piApprovePayment', () => {
  it('calls the Pi sandbox approve endpoint with correct headers', async () => {
    mockFetchOk();

    await piApprovePayment(TEST_PI_PAYMENT_ID);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.sandbox.minepi.com/v2/payments/${TEST_PI_PAYMENT_ID}/approve`);
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Key test-pi-api-key');
    expect(opts.method).toBe('POST');
  });

  it('uses the mainnet URL when PI_SANDBOX=false', async () => {
    process.env.PI_SANDBOX = 'false';
    mockFetchOk();

    await piApprovePayment(TEST_PI_PAYMENT_ID);

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain('https://api.minepi.com');
  });

  it('resolves without error on HTTP 200', async () => {
    mockFetchOk();
    await expect(piApprovePayment(TEST_PI_PAYMENT_ID)).resolves.toBeUndefined();
  });

  it('throws PiApiError with PI_APPROVE_FAILED on non-200 HTTP response', async () => {
    mockFetchError(400, 'bad request');

    await expect(piApprovePayment(TEST_PI_PAYMENT_ID)).rejects.toMatchObject({
      name: 'PiApiError',
      code: 'PI_APPROVE_FAILED',
      httpStatus: 502,
    });
  });

  it('throws PiApiError with PI_APPROVE_FAILED on 500 response', async () => {
    mockFetchError(500, 'internal error');

    await expect(piApprovePayment(TEST_PI_PAYMENT_ID)).rejects.toMatchObject({
      code: 'PI_APPROVE_FAILED',
      httpStatus: 502,
    });
  });

  it('throws PiApiError with PI_TIMEOUT on AbortError', async () => {
    mockFetchAbort();

    await expect(piApprovePayment(TEST_PI_PAYMENT_ID)).rejects.toMatchObject({
      name: 'PiApiError',
      code: 'PI_TIMEOUT',
      httpStatus: 504,
    });
  });

  it('throws PiApiError with PI_NETWORK_ERROR on network failure', async () => {
    mockFetchNetworkError('ECONNREFUSED');

    await expect(piApprovePayment(TEST_PI_PAYMENT_ID)).rejects.toMatchObject({
      name: 'PiApiError',
      code: 'PI_NETWORK_ERROR',
      httpStatus: 502,
    });
  });

  it('throws PiApiError with PI_CONFIG_ERROR when PI_API_KEY is missing', async () => {
    delete process.env.PI_API_KEY;

    await expect(piApprovePayment(TEST_PI_PAYMENT_ID)).rejects.toMatchObject({
      name: 'PiApiError',
      code: 'PI_CONFIG_ERROR',
      httpStatus: 500,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('URL-encodes the piPaymentId', async () => {
    mockFetchOk();
    const id = 'pi/special+chars';

    await piApprovePayment(id);

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain(encodeURIComponent(id));
  });
});

// ─── piCompletePayment ────────────────────────────────────────────────────────

describe('piCompletePayment', () => {
  it('calls the Pi sandbox complete endpoint with txid in body', async () => {
    mockFetchOk();

    await piCompletePayment(TEST_PI_PAYMENT_ID, TEST_TX_ID);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.sandbox.minepi.com/v2/payments/${TEST_PI_PAYMENT_ID}/complete`);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ txid: TEST_TX_ID });
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Key test-pi-api-key');
  });

  it('uses the mainnet URL when PI_SANDBOX=false', async () => {
    process.env.PI_SANDBOX = 'false';
    mockFetchOk();

    await piCompletePayment(TEST_PI_PAYMENT_ID, TEST_TX_ID);

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain('https://api.minepi.com');
  });

  it('resolves without error on HTTP 200', async () => {
    mockFetchOk();
    await expect(piCompletePayment(TEST_PI_PAYMENT_ID, TEST_TX_ID)).resolves.toBeUndefined();
  });

  it('sends empty string when txId is undefined', async () => {
    mockFetchOk();

    await piCompletePayment(TEST_PI_PAYMENT_ID, undefined);

    const [, opts] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ txid: '' });
  });

  it('throws PiApiError with PI_COMPLETE_FAILED on non-200 HTTP response', async () => {
    mockFetchError(422, 'unprocessable');

    await expect(piCompletePayment(TEST_PI_PAYMENT_ID, TEST_TX_ID)).rejects.toMatchObject({
      name: 'PiApiError',
      code: 'PI_COMPLETE_FAILED',
      httpStatus: 502,
    });
  });

  it('throws PiApiError with PI_TIMEOUT on AbortError', async () => {
    mockFetchAbort();

    await expect(piCompletePayment(TEST_PI_PAYMENT_ID, TEST_TX_ID)).rejects.toMatchObject({
      name: 'PiApiError',
      code: 'PI_TIMEOUT',
      httpStatus: 504,
    });
  });

  it('throws PiApiError with PI_NETWORK_ERROR on network failure', async () => {
    mockFetchNetworkError('ETIMEDOUT');

    await expect(piCompletePayment(TEST_PI_PAYMENT_ID, TEST_TX_ID)).rejects.toMatchObject({
      name: 'PiApiError',
      code: 'PI_NETWORK_ERROR',
      httpStatus: 502,
    });
  });

  it('throws PiApiError with PI_CONFIG_ERROR when PI_API_KEY is missing', async () => {
    delete process.env.PI_API_KEY;

    await expect(piCompletePayment(TEST_PI_PAYMENT_ID, TEST_TX_ID)).rejects.toMatchObject({
      name: 'PiApiError',
      code: 'PI_CONFIG_ERROR',
      httpStatus: 500,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
