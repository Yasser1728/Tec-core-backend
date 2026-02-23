/**
 * Security tests covering four critical edge-case scenarios for the
 * Payment Service Phase 3 middleware stack:
 *
 * 1. JWT middleware — expiry, invalid tokens, wrong algorithm, role/sessionId attachment
 * 2. Rate-limit breach — 429 + Retry-After, per-user isolation
 * 3. Idempotency middleware — missing/short key, duplicate-request replay
 * 4. Request correlation — X-Request-Id generated when absent, propagated in response
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
  idempotency,
  InMemoryIdempotencyStore,
  setIdempotencyStore,
} from '../../src/middlewares/idempotency.middleware';
import { v4 as uuidv4 } from 'uuid';

const TEST_SECRET = 'test-secret-for-payment-unit-tests-only';

const signToken = (
  userId: string,
  opts: jwt.SignOptions = { expiresIn: '1h' },
  extra: Record<string, unknown> = {},
): string => jwt.sign({ userId, ...extra }, TEST_SECRET, opts);

// ─── JWT middleware tests ──────────────────────────────────────────────────────

describe('JWT authenticate middleware', () => {
  let app: Application;

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    app = express();
    app.use(express.json());
    app.get('/protected', authenticate, (req: Request, res: Response) => {
      res.json({
        userId: req.userId,
        user: req.user,
      });
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
      .set('Authorization', 'Bearer not.a.real.jwt');
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

  it('returns 401 for an expired token (well outside clock tolerance)', async () => {
    // Sign with exp in the past (beyond the 30-second tolerance)
    const expiredToken = jwt.sign({ userId: 'u-expired' }, TEST_SECRET, { expiresIn: -120 });
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('returns 401 for a token signed with a non-HS256 algorithm (HS384)', async () => {
    // The middleware enforces algorithms: ['HS256'] — any other alg must be rejected
    const hs384Token = jwt.sign({ userId: 'u2' }, TEST_SECRET, { algorithm: 'HS384' });
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${hs384Token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('passes and attaches userId, role, sessionId for a valid token', async () => {
    const token = signToken('pay-user-1', { expiresIn: '1h' }, { role: 'user', sessionId: 'sess-abc' });
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('pay-user-1');
    expect(res.body.user.id).toBe('pay-user-1');
    expect(res.body.user.role).toBe('user');
    expect(res.body.user.sessionId).toBe('sess-abc');
  });

  it('passes when token has no role/sessionId (optional fields)', async () => {
    const token = signToken('pay-user-2');
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('pay-user-2');
    expect(res.body.user.role).toBeUndefined();
    expect(res.body.user.sessionId).toBeUndefined();
  });

  it('returns 500 when JWT_SECRET is not configured', async () => {
    delete process.env.JWT_SECRET;
    const token = signToken('u3');
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
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
    // Tight window: 2 requests per minute for testing
    app.post('/action', createRateLimiter(2, 60000), (_req, res) => {
      res.json({ ok: true });
    });
  });

  afterEach(() => {
    freshStore();
  });

  it('blocks the (n+1)-th request with HTTP 429', async () => {
    const uid = 'rl-pay-user-1';
    await request(app).post('/action').send({ userId: uid });
    await request(app).post('/action').send({ userId: uid });
    const third = await request(app).post('/action').send({ userId: uid });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('includes a Retry-After header on 429', async () => {
    const uid = 'rl-pay-user-2';
    await request(app).post('/action').send({ userId: uid });
    await request(app).post('/action').send({ userId: uid });
    const res = await request(app).post('/action').send({ userId: uid });
    expect(res.headers).toHaveProperty('retry-after');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('does not affect a different user when one user is rate-limited', async () => {
    const uid1 = 'rl-pay-user-3';
    const uid2 = 'rl-pay-user-4';
    await request(app).post('/action').send({ userId: uid1 });
    await request(app).post('/action').send({ userId: uid1 });
    await request(app).post('/action').send({ userId: uid1 }); // uid1 throttled
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

    const token = signToken('jwt-pay-user-5');
    await request(tokenApp).post('/action').set('Authorization', `Bearer ${token}`);
    await request(tokenApp).post('/action').set('Authorization', `Bearer ${token}`);
    const third = await request(tokenApp).post('/action').set('Authorization', `Bearer ${token}`);
    expect(third.status).toBe(429);

    delete process.env.JWT_SECRET;
  });
});

// ─── Idempotency middleware tests ─────────────────────────────────────────────

describe('Idempotency middleware', () => {
  let app: Application;

  beforeEach(() => {
    // Reset to a fresh in-memory store between tests.
    setIdempotencyStore(new InMemoryIdempotencyStore());

    app = express();
    app.use(express.json());

    // Simulate authenticated user so storeKey uses userId
    app.use((req: Request, _res, next) => {
      (req as any).user = { id: 'test-user-idempotency' };
      next();
    });

    app.post('/action', idempotency as express.RequestHandler, (_req, res) => {
      res.status(201).json({ created: true, ts: Date.now() });
    });
  });

  afterEach(() => {
    setIdempotencyStore(new InMemoryIdempotencyStore());
  });

  it('returns 400 when Idempotency-Key header is absent', async () => {
    const res = await request(app).post('/action').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('returns 400 when Idempotency-Key exceeds 255 characters', async () => {
    const res = await request(app)
      .post('/action')
      .set('Idempotency-Key', 'a'.repeat(256))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('processes the first request normally', async () => {
    const key = uuidv4(); // 36-char UUID
    const res = await request(app)
      .post('/action')
      .set('Idempotency-Key', key)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
  });

  it('replays the cached response on a duplicate request', async () => {
    const key = uuidv4();

    const first = await request(app)
      .post('/action')
      .set('Idempotency-Key', key)
      .send({});
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/action')
      .set('Idempotency-Key', key)
      .send({});
    // Same status code and body as the first response
    expect(second.status).toBe(201);
    expect(second.body.created).toBe(first.body.created);
    expect(second.body.ts).toBe(first.body.ts); // exact same cached timestamp
  });

  it('treats different keys as independent requests', async () => {
    const key1 = uuidv4();
    const key2 = uuidv4();

    const res1 = await request(app)
      .post('/action')
      .set('Idempotency-Key', key1)
      .send({});
    const res2 = await request(app)
      .post('/action')
      .set('Idempotency-Key', key2)
      .send({});

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    // Both succeed (not treated as duplicates)
    expect(res1.body.ts).not.toBe(res2.body.ts);
  });
});

// ─── Request correlation (X-Request-Id) tests ─────────────────────────────────

describe('X-Request-Id correlation', () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    app.use((req: Request, res: Response, next) => {
      const id = (req.headers['x-request-id'] as string | undefined) || uuidv4();
      req.requestId = id;
      res.setHeader('X-Request-Id', id);
      next();
    });
    app.get('/ping', (req: Request, res: Response) => {
      res.json({ requestId: req.requestId });
    });
  });

  it('generates an X-Request-Id when none is provided', async () => {
    const res = await request(app).get('/ping');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('echoes back a caller-supplied X-Request-Id', async () => {
    const customId = 'my-trace-id-12345';
    const res = await request(app).get('/ping').set('X-Request-Id', customId);
    expect(res.headers['x-request-id']).toBe(customId);
    expect(res.body.requestId).toBe(customId);
  });

  it('propagates the request ID to the response body via req.requestId', async () => {
    const res = await request(app).get('/ping');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});
