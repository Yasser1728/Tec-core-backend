/**
 * Security tests covering the four critical scenarios:
 * 1. Unauthorized access — financial routes require a valid JWT.
 * 2. Double-spend protection — withdraw/transfer reject insufficient-balance requests.
 * 3. Rate-limit breach — 429 after exceeding the per-user window.
 * 4. JWT middleware — verifies token, rejects invalid/missing tokens.
 */
import request from 'supertest';
import express, { Application, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createRateLimiter, InMemoryStore, setStore } from '../../src/middlewares/rateLimit.middleware';
import { authenticate } from '../../src/middlewares/jwt.middleware';

const TEST_SECRET = 'test-secret-for-unit-tests-only';

/** Sign a token using the shared test secret. */
const signToken = (userId: string): string =>
  jwt.sign({ userId }, TEST_SECRET, { expiresIn: '1h' });

// ─── JWT middleware tests ──────────────────────────────────────────────────────

describe('JWT authenticate middleware', () => {
  let app: Application;

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    app = express();
    app.use(express.json());
    app.get('/protected', authenticate, (req: Request, res: Response) => {
      res.json({ userId: req.userId });
    });
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('returns 401 when Authorization header is absent', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('returns 401 when token is malformed', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('returns 401 when token is signed with the wrong secret', async () => {
    const badToken = jwt.sign({ userId: 'u1' }, 'wrong-secret');
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${badToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('passes and sets req.userId for a valid token', async () => {
    const token = signToken('user-42');
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-42');
  });

  it('returns 401 for an expired token', async () => {
    const expiredToken = jwt.sign({ userId: 'u1' }, TEST_SECRET, { expiresIn: -1 });
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});

// ─── Rate-limit breach tests ───────────────────────────────────────────────────

describe('Rate-limit breach', () => {
  /** Fresh in-memory store per test so windows don't bleed across tests. */
  const freshStore = (): void => setStore(new InMemoryStore());

  let app: Application;

  beforeEach(() => {
    freshStore();
    app = express();
    app.use(express.json());
    // Allow only 2 requests per minute for this test app.
    app.post('/action', createRateLimiter(2, 60000), (_req, res) => {
      res.json({ ok: true });
    });
  });

  afterEach(() => {
    freshStore();
  });

  it('blocks the (n+1)-th request with HTTP 429', async () => {
    const uid = 'rl-test-user-1';
    await request(app).post('/action').send({ userId: uid });
    await request(app).post('/action').send({ userId: uid });
    const third = await request(app).post('/action').send({ userId: uid });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('includes a Retry-After header on 429', async () => {
    const uid = 'rl-test-user-2';
    await request(app).post('/action').send({ userId: uid });
    await request(app).post('/action').send({ userId: uid });
    const res = await request(app).post('/action').send({ userId: uid });
    expect(res.headers).toHaveProperty('retry-after');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('does not affect a different user when one user is rate-limited', async () => {
    const uid1 = 'rl-test-user-3';
    const uid2 = 'rl-test-user-4';
    // Exhaust uid1's quota.
    await request(app).post('/action').send({ userId: uid1 });
    await request(app).post('/action').send({ userId: uid1 });
    await request(app).post('/action').send({ userId: uid1 });
    // uid2 must still succeed.
    const res = await request(app).post('/action').send({ userId: uid2 });
    expect(res.status).toBe(200);
  });

  it('uses req.userId (from JWT middleware) as the rate-limit key', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    freshStore();

    const tokenApp = express();
    tokenApp.use(express.json());
    // Authenticate first so req.userId is populated, then rate-limit.
    tokenApp.post(
      '/action',
      authenticate,
      createRateLimiter(2, 60000),
      (_req, res) => res.json({ ok: true }),
    );

    const token = signToken('jwt-user-5');
    await request(tokenApp).post('/action').set('Authorization', `Bearer ${token}`);
    await request(tokenApp).post('/action').set('Authorization', `Bearer ${token}`);
    const third = await request(tokenApp).post('/action').set('Authorization', `Bearer ${token}`);
    expect(third.status).toBe(429);

    delete process.env.JWT_SECRET;
  });
});

// ─── Double-spend / insufficient-balance tests ────────────────────────────────

describe('Double-spend protection (controller logic)', () => {
  /**
   * These tests stub the Prisma client to exercise the withdraw/transfer
   * balance-check logic without needing a real database.
   */

  it('withdraw controller rejects with INSUFFICIENT_BALANCE when balance < amount', async () => {
    // Dynamically import the controller and mock prisma.
    // We test the exported handler directly by constructing fake req/res objects.
    const { withdraw } = await import('../../src/controllers/wallet.controller');

    const walletId = '00000000-0000-0000-0000-000000000001';

    // Mock prisma.$transaction to simulate a wallet with balance 10.
    const { prisma } = await import('../../src/config/database');
    const spy = jest
      .spyOn(prisma, '$transaction')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementationOnce(async (fn: any) => {
        const fakeTx = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue({ id: walletId, balance: 10 }),
            update: jest.fn(),
          },
          transaction: { create: jest.fn() },
          auditLog: { create: jest.fn() },
        };
        return fn(fakeTx);
      });

    const req = {
      params: { id: walletId },
      body: { amount: 100, assetType: 'USD' },
      userId: 'user-1',
    } as unknown as Request;

    let statusCode = 0;
    let body: unknown = {};
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (data: unknown) => { body = data; },
    } as unknown as Response;

    await withdraw(req, res);

    expect(statusCode).toBe(422);
    expect((body as { error: { code: string } }).error.code).toBe('INSUFFICIENT_BALANCE');

    spy.mockRestore();
  });

  it('transfer controller rejects with INSUFFICIENT_BALANCE for source wallet', async () => {
    const { transfer } = await import('../../src/controllers/wallet.controller');

    const fromId = '00000000-0000-0000-0000-000000000002';
    const toId   = '00000000-0000-0000-0000-000000000003';

    const { prisma } = await import('../../src/config/database');
    const spy = jest
      .spyOn(prisma, '$transaction')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementationOnce(async (fn: any) => {
        const fakeTx = {
          wallet: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce({ id: fromId, balance: 5 })
              .mockResolvedValueOnce({ id: toId,   balance: 100 }),
            update: jest.fn(),
          },
          transaction: { create: jest.fn() },
          auditLog: { create: jest.fn() },
        };
        return fn(fakeTx);
      });

    const req = {
      params: {},
      body: { fromWalletId: fromId, toWalletId: toId, amount: 50, assetType: 'USD' },
      userId: 'user-1',
    } as unknown as Request;

    let statusCode = 0;
    let body: unknown = {};
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (data: unknown) => { body = data; },
    } as unknown as Response;

    await transfer(req, res);

    expect(statusCode).toBe(422);
    expect((body as { error: { code: string } }).error.code).toBe('INSUFFICIENT_BALANCE');

    spy.mockRestore();
  });
});

// ─── Unauthorized-access end-to-end route tests ───────────────────────────────

describe('Unauthorized access to financial routes', () => {
  let app: Application;

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    app = express();
    app.use(express.json());

    // Wire up a minimal route matching the real financial routes.
    app.post('/:id/deposit', authenticate, (_req, res) => res.json({ ok: true }));
    app.post('/:id/withdraw', authenticate, (_req, res) => res.json({ ok: true }));
    app.post('/transfer', authenticate, (_req, res) => res.json({ ok: true }));
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('deposit returns 401 without token', async () => {
    const res = await request(app)
      .post('/00000000-0000-0000-0000-000000000001/deposit')
      .send({ amount: 10 });
    expect(res.status).toBe(401);
  });

  it('withdraw returns 401 without token', async () => {
    const res = await request(app)
      .post('/00000000-0000-0000-0000-000000000001/withdraw')
      .send({ amount: 10 });
    expect(res.status).toBe(401);
  });

  it('transfer returns 401 without token', async () => {
    const res = await request(app)
      .post('/transfer')
      .send({ fromWalletId: '00000000-0000-0000-0000-000000000001', toWalletId: '00000000-0000-0000-0000-000000000002', amount: 10 });
    expect(res.status).toBe(401);
  });

  it('deposit succeeds with a valid token', async () => {
    // Stub the actual handler — we only care about the auth gate here.
    const token = signToken('user-99');
    const res = await request(app)
      .post('/00000000-0000-0000-0000-000000000001/deposit')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 10 });
    // The stub handler returns 200 when auth passes.
    expect(res.status).toBe(200);
  });
});
