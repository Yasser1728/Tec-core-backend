import { Request, Response, NextFunction } from 'express';

// Use a very short window so the reset test runs quickly
process.env.RATE_LIMIT_WINDOW = '200'; // 200 ms
process.env.RATE_LIMIT_MAX = '3';

// Re-import after env is set so the module picks up the values
jest.resetModules();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { rateLimitMiddleware, InMemoryStore } = require('../../src/middlewares/rate-limit.middleware');

/** Minimal mock helpers */
const makeReq = (ip = '127.0.0.1'): Partial<Request> => ({ ip, headers: {} });

const mockRes = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('rateLimitMiddleware', () => {
  it('allows requests below the limit', async () => {
    const next = jest.fn() as NextFunction;
    for (let i = 0; i < 3; i++) {
      await rateLimitMiddleware(makeReq('10.0.0.1') as Request, mockRes(), next);
    }
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('blocks the request that exceeds the limit and returns 429', async () => {
    const next = jest.fn() as NextFunction;

    // Exhaust the limit from a fresh IP
    for (let i = 0; i < 3; i++) {
      await rateLimitMiddleware(makeReq('10.0.0.2') as Request, mockRes(), next);
    }
    // 4th request should be blocked
    const res = mockRes();
    await rateLimitMiddleware(makeReq('10.0.0.2') as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  it('does not affect other IPs', async () => {
    const next = jest.fn() as NextFunction;

    // Exhaust limit for one IP
    for (let i = 0; i < 3; i++) {
      await rateLimitMiddleware(makeReq('10.0.0.3') as Request, mockRes(), next);
    }
    // Different IP should still pass
    const res = mockRes();
    await rateLimitMiddleware(makeReq('10.0.0.4') as Request, res, next);

    expect(res.status).not.toHaveBeenCalledWith(429);
  });
});

describe('InMemoryStore', () => {
  it('resets the counter after the window expires', async () => {
    const store = new InMemoryStore();
    const key = 'reset-test-ip';

    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      await store.increment(key);
    }
    expect(await store.increment(key)).toBe(4); // over limit

    // Wait for the window to expire (RATE_LIMIT_WINDOW = 200 ms)
    await new Promise((r) => setTimeout(r, 250));

    // Counter should reset to 1
    expect(await store.increment(key)).toBe(1);
  });
});
