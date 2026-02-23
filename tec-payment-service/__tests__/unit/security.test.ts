/**
 * Security tests for Phase 3 payment service additions:
 * 1. JWT middleware — verifies token, rejects invalid/missing tokens.
 * 2. Rate-limit breach — 429 after exceeding the per-user window.
 * 3. Idempotency middleware — caches responses and replays them.
 * 4. Unauthorized access — payment routes require a valid JWT.
 */
import request from 'supertest';
import express, { Application, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import {
  createRateLimiter,
  InMemoryStore,
  setStore,
} from '../../src/middlewares/rate-limit.middleware';
import { authenticate } from '../../src/middlewares/jwt.middleware';
import {
  idempotencyMiddleware,
  InMemoryIdempotencyStore,
  setIdempotencyStore,
} from '../../src/middlewares/idempotency.middleware';

const TEST_SECRET = 'test-secret-for-unit-tests-only';

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
  const freshStore = (): void => setStore(new InMemoryStore());

  let app: Application;

  beforeEach(() => {
    freshStore();
    app = express();
    app.use(express.json());
    app.post('/action', createRateLimiter(2, 60000), (_req, res) => {
      res.json({ ok: true });
    });
  });

  afterEach(() => {
    freshStore();
  });

  it('allows requests within the limit', async () => {
    const res1 = await request(app).post('/action').send({ userId: 'user1' });
    expect(res1.status).toBe(200);
    const res2 = await request(app).post('/action').send({ userId: 'user1' });
    expect(res2.status).toBe(200);
  });

  it('blocks the (n+1)-th request with HTTP 429', async () => {
    const uid = 'rl-user-1';
    await request(app).post('/action').send({ userId: uid });
    await request(app).post('/action').send({ userId: uid });
    const third = await request(app).post('/action').send({ userId: uid });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('includes a Retry-After header on 429', async () => {
    const uid = 'rl-user-2';
    await request(app).post('/action').send({ userId: uid });
    await request(app).post('/action').send({ userId: uid });
    const res = await request(app).post('/action').send({ userId: uid });
    expect(res.headers).toHaveProperty('retry-after');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('does not affect a different user when one is rate-limited', async () => {
    const uid1 = 'rl-user-3';
    const uid2 = 'rl-user-4';
    await request(app).post('/action').send({ userId: uid1 });
    await request(app).post('/action').send({ userId: uid1 });
    await request(app).post('/action').send({ userId: uid1 });
    const res = await request(app).post('/action').send({ userId: uid2 });
    expect(res.status).toBe(200);
  });

  it('uses req.userId (from JWT middleware) as the rate-limit key', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    freshStore();

    const tokenApp = express();
    tokenApp.use(express.json());
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

// ─── Idempotency middleware tests ──────────────────────────────────────────────

describe('Idempotency middleware', () => {
  let callCount: number;
  let app: Application;

  beforeEach(() => {
    setIdempotencyStore(new InMemoryIdempotencyStore());
    callCount = 0;
    process.env.JWT_SECRET = TEST_SECRET;

    app = express();
    app.use(express.json());

    // Use requireKey=false so we can also test the warn-only path
    app.post(
      '/pay',
      authenticate,
      idempotencyMiddleware(true),
      (_req, res) => {
        callCount++;
        res.status(201).json({ success: true, count: callCount });
      },
    );
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    setIdempotencyStore(new InMemoryIdempotencyStore());
  });

  it('returns 400 when Idempotency-Key is missing', async () => {
    const token = signToken('user-idem-1');
    const res = await request(app)
      .post('/pay')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('executes handler on first request and returns its response', async () => {
    const token = signToken('user-idem-2');
    const res = await request(app)
      .post('/pay')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'key-abc')
      .send({ amount: 10 });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(callCount).toBe(1);
  });

  it('replays cached response on duplicate request without re-executing handler', async () => {
    const token = signToken('user-idem-3');
    const headers = {
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': 'key-xyz',
    };

    const first = await request(app).post('/pay').set(headers).send({ amount: 10 });
    expect(first.status).toBe(201);
    expect(callCount).toBe(1);

    const second = await request(app).post('/pay').set(headers).send({ amount: 10 });
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    // Handler must NOT have been called again
    expect(callCount).toBe(1);
  });

  it('treats different keys as independent requests', async () => {
    const token = signToken('user-idem-4');
    const auth = `Bearer ${token}`;

    await request(app)
      .post('/pay')
      .set('Authorization', auth)
      .set('Idempotency-Key', 'key-1')
      .send({ amount: 10 });

    await request(app)
      .post('/pay')
      .set('Authorization', auth)
      .set('Idempotency-Key', 'key-2')
      .send({ amount: 10 });

    expect(callCount).toBe(2);
  });

  it('treats the same key from different users as independent', async () => {
    const token1 = signToken('user-idem-5a');
    const token2 = signToken('user-idem-5b');

    await request(app)
      .post('/pay')
      .set('Authorization', `Bearer ${token1}`)
      .set('Idempotency-Key', 'shared-key')
      .send({ amount: 10 });

    await request(app)
      .post('/pay')
      .set('Authorization', `Bearer ${token2}`)
      .set('Idempotency-Key', 'shared-key')
      .send({ amount: 10 });

    expect(callCount).toBe(2);
  });
});

// ─── Unauthorized access to payment routes ─────────────────────────────────────

describe('Unauthorized access to payment routes', () => {
  let app: Application;

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    app = express();
    app.use(express.json());
    app.post('/payments/create', authenticate, (_req, res) => res.json({ ok: true }));
    app.post('/payments/approve', authenticate, (_req, res) => res.json({ ok: true }));
    app.post('/payments/cancel', authenticate, (_req, res) => res.json({ ok: true }));
    app.get('/payments/:id/status', authenticate, (_req, res) => res.json({ ok: true }));
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('create returns 401 without token', async () => {
    const res = await request(app).post('/payments/create').send({ amount: 10 });
    expect(res.status).toBe(401);
  });

  it('approve returns 401 without token', async () => {
    const res = await request(app).post('/payments/approve').send({ payment_id: 'abc' });
    expect(res.status).toBe(401);
  });

  it('cancel returns 401 without token', async () => {
    const res = await request(app).post('/payments/cancel').send({ payment_id: 'abc' });
    expect(res.status).toBe(401);
  });

  it('status returns 401 without token', async () => {
    const res = await request(app).get('/payments/some-id/status');
    expect(res.status).toBe(401);
  });

  it('create succeeds with a valid token', async () => {
    const token = signToken('user-auth-1');
    const res = await request(app)
      .post('/payments/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 10 });
    expect(res.status).toBe(200);
  });
});
