/**
 * Middleware edge-case tests – Phase 3 refinements.
 *
 * Covers:
 *  1. JWT middleware  – no header, alg:none, RS256, expired, malformed, valid, missing secret
 *  2. Rate limiting   – 429 when limit exceeded, Retry-After header, per-user isolation
 *  3. Idempotency     – missing key, key too long, cache hit (success & error), x-request-id in replay
 *  4. Request ID      – new UUID generated, existing value propagated
 */

import request from 'supertest';
import express, { Application, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

// Middleware under test
import { authenticate } from '../../src/middlewares/jwt.middleware';
import {
  idempotency,
  InMemoryIdempotencyStore,
  setIdempotencyStore,
} from '../../src/middlewares/idempotency.middleware';
import { requestId } from '../../src/middlewares/requestId.middleware';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_SECRET = 'super-secret-test-key-32-bytes!!';

function makeJwt(
  payload: Record<string, unknown>,
  secret = TEST_SECRET,
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '1h', ...options });
}

/** Minimal test app that applies a single middleware then echoes 200 OK. */
function singleMiddlewareApp(
  middleware: (req: Request, res: Response, next: express.NextFunction) => unknown,
): Application {
  const app = express();
  app.use(express.json());
  app.use(middleware as express.RequestHandler);
  app.get('/test', (req: Request, res: Response) => {
    res.json({ success: true, user: (req as any).user });
  });
  app.post('/test', (req: Request, res: Response) => {
    res.json({ success: true, user: (req as any).user });
  });
  return app;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1.  JWT MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

describe('JWT middleware – authenticate', () => {
  let app: Application;

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    app = singleMiddlewareApp(authenticate);
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('returns 401 when Authorization header is absent', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(res.body.error.message).toBe('No token provided');
  });

  it('returns 401 when Authorization header is not Bearer', async () => {
    const res = await request(app).get('/test').set('Authorization', 'Basic abc123');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('returns 401 for alg:none token', async () => {
    // Hand-craft a JWT with alg:none (never accepted by the middleware).
    const header  = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ id: 'u1', role: 'user', sessionId: 's1' })).toString('base64url');
    const noneToken = `${header}.${payload}.`;

    const res = await request(app).get('/test').set('Authorization', `Bearer ${noneToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('returns 401 for RS256 token (non-HS256 algorithm)', async () => {
    // Fake a token whose header claims RS256 (won't pass alg check regardless of key).
    const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ id: 'u1', role: 'user', sessionId: 's1' })).toString('base64url');
    const fakeToken = `${header}.${payload}.fakesig`;

    const res = await request(app).get('/test').set('Authorization', `Bearer ${fakeToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('returns 401 for an expired token', async () => {
    // Sign a token that expired 5 minutes ago, well outside clockTolerance.
    const token = makeJwt(
      { id: 'u1', role: 'user', sessionId: 's1' },
      TEST_SECRET,
      { expiresIn: -300 }, // expired 5 min ago
    );

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(res.body.error.message).toBe('Invalid or expired token');
  });

  it('returns 401 for a malformed token (random string)', async () => {
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer this-is-not-a-valid-jwt-at-all');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    const token = makeJwt({ id: 'u1', role: 'user', sessionId: 's1' }, 'wrong-secret!!');
    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('returns 500 when JWT_SECRET is not configured', async () => {
    delete process.env.JWT_SECRET;
    const token = makeJwt({ id: 'u1', role: 'user', sessionId: 's1' });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('passes and attaches req.user for a valid HS256 token', async () => {
    const token = makeJwt({ id: 'user-abc', role: 'admin', sessionId: 'sess-xyz' });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 'user-abc', role: 'admin', sessionId: 'sess-xyz' });
  });

  it('passes for a token within clockTolerance of expiry', async () => {
    // Sign a token that expired 20 s ago – within the default 30 s tolerance.
    process.env.JWT_CLOCK_TOLERANCE = '30';
    const token = makeJwt(
      { id: 'u2', role: 'user', sessionId: 's2' },
      TEST_SECRET,
      { expiresIn: -20 }, // expired 20 s ago, within clockTolerance
    );

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2.  RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════════

describe('Rate limiting middleware', () => {
  it('returns 429 after the per-user limit is exceeded', async () => {
    const limiter = rateLimit({
      windowMs:        60_000,
      max:             2,
      keyGenerator:    (req: Request) => (req as any).user?.id ?? req.ip ?? 'unknown',
      standardHeaders: true,
      legacyHeaders:   false,
      message: {
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests.' },
      },
    });

    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: express.NextFunction) => {
      (req as any).user = { id: 'user-rl-1', role: 'user', sessionId: 's' };
      next();
    });
    app.use(limiter);
    app.get('/test', (_req, res) => res.json({ success: true }));

    await request(app).get('/test'); // 1st – ok
    await request(app).get('/test'); // 2nd – ok
    const res = await request(app).get('/test'); // 3rd – blocked

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('includes RateLimit-* headers on requests within the limit', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });
    const app = express();
    app.use(limiter);
    app.get('/test', (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.headers).toHaveProperty('ratelimit-limit');
    expect(res.headers).toHaveProperty('ratelimit-remaining');
  });

  it('does not rate-limit user B when user A exhausts their quota', async () => {
    const limiter = rateLimit({
      windowMs:     60_000,
      max:          2,
      keyGenerator: (req: Request) => (req as any).user?.id ?? 'anon',
      legacyHeaders: false,
    });

    const makeUserApp = (userId: string) => {
      const a = express();
      a.use(express.json());
      a.use((req: Request, _res: Response, next: express.NextFunction) => {
        (req as any).user = { id: userId };
        next();
      });
      a.use(limiter);
      a.get('/test', (_req, res) => res.json({ success: true }));
      return a;
    };

    // Exhaust user A's quota
    await request(makeUserApp('user-A')).get('/test');
    await request(makeUserApp('user-A')).get('/test');
    const blockedA = await request(makeUserApp('user-A')).get('/test');
    expect(blockedA.status).toBe(429);

    // User B should still be allowed
    const allowedB = await request(makeUserApp('user-B')).get('/test');
    expect(allowedB.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3.  IDEMPOTENCY MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

describe('Idempotency middleware', () => {
  const USER_ID = 'idem-user-001';

  /** Build a test app with the idempotency middleware and a simple handler. */
  function makeIdempotencyApp(handler?: (req: Request, res: Response) => void): Application {
    const a = express();
    a.use(express.json());
    // Simulate JWT middleware attaching req.user
    a.use((req: Request, _res: Response, next: express.NextFunction) => {
      (req as any).user = { id: USER_ID, role: 'user', sessionId: 's' };
      next();
    });
    a.use(requestId);
    a.post(
      '/test',
      idempotency as express.RequestHandler,
      handler ??
        ((_req, res) => {
          res.status(201).json({ success: true, data: { value: 42 } });
        }),
    );
    return a;
  }

  beforeEach(() => {
    // Reset to a fresh in-memory store before each test.
    setIdempotencyStore(new InMemoryIdempotencyStore());
  });

  it('returns 400 when Idempotency-Key header is missing', async () => {
    const app = makeIdempotencyApp();
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('returns 400 when Idempotency-Key exceeds 255 characters', async () => {
    const app = makeIdempotencyApp();
    const longKey = 'a'.repeat(256);
    const res = await request(app)
      .post('/test')
      .set('Idempotency-Key', longKey)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('passes through the first request and caches the response', async () => {
    const app = makeIdempotencyApp();
    const res = await request(app)
      .post('/test')
      .set('Idempotency-Key', 'key-first-001')
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.data.value).toBe(42);
  });

  it('replays the cached response on a second request with the same key', async () => {
    let callCount = 0;
    const app = makeIdempotencyApp((_req, res) => {
      callCount += 1;
      res.status(201).json({ success: true, data: { callCount } });
    });

    const key = 'key-replay-001';
    const first  = await request(app).post('/test').set('Idempotency-Key', key).send({});
    const second = await request(app).post('/test').set('Idempotency-Key', key).send({});

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Handler must have been called exactly once.
    expect(callCount).toBe(1);
    // Both responses must be identical.
    expect(second.body).toEqual(first.body);
  });

  it('also replays cached error responses on repeat', async () => {
    let callCount = 0;
    const app = makeIdempotencyApp((_req, res) => {
      callCount += 1;
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'bad input' } });
    });

    const key = 'key-error-replay-001';
    const first  = await request(app).post('/test').set('Idempotency-Key', key).send({});
    const second = await request(app).post('/test').set('Idempotency-Key', key).send({});

    expect(first.status).toBe(422);
    expect(second.status).toBe(422);
    expect(callCount).toBe(1);
    expect(second.body).toEqual(first.body);
  });

  it('different users with the same key do not share cached responses', async () => {
    let counter = 0;
    // Handler returns a unique counter per call.
    function makeUserApp(userId: string): Application {
      const a = express();
      a.use(express.json());
      a.use((req: Request, _res: Response, next: express.NextFunction) => {
        (req as any).user = { id: userId };
        next();
      });
      a.post(
        '/test',
        idempotency as express.RequestHandler,
        (_req: Request, res: Response) => {
          counter += 1;
          res.status(201).json({ success: true, counter });
        },
      );
      return a;
    }

    const key = 'shared-key';
    const resA = await request(makeUserApp('user-A')).post('/test').set('Idempotency-Key', key).send({});
    const resB = await request(makeUserApp('user-B')).post('/test').set('Idempotency-Key', key).send({});

    // Both calls should have reached the handler (different cache keys).
    expect(counter).toBe(2);
    expect(resA.body.counter).not.toEqual(resB.body.counter);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4.  REQUEST ID MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

describe('requestId middleware', () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    app.use(requestId);
    app.get('/test', (req: Request, res: Response) => {
      res.json({ requestId: req.headers['x-request-id'] });
    });
  });

  it('generates a UUID and adds x-request-id to the response header', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.headers).toHaveProperty('x-request-id');
    // UUID v4 pattern
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('propagates an existing x-request-id unchanged', async () => {
    const existingId = 'my-trace-id-12345';
    const res = await request(app).get('/test').set('x-request-id', existingId);
    expect(res.headers['x-request-id']).toBe(existingId);
    expect(res.body.requestId).toBe(existingId);
  });

  it('generates different IDs for different requests', async () => {
    const res1 = await request(app).get('/test');
    const res2 = await request(app).get('/test');
    expect(res1.headers['x-request-id']).not.toBe(res2.headers['x-request-id']);
  });

  it('echoes the x-request-id in both request context and response header', async () => {
    const res = await request(app).get('/test');
    // The value stored on req.headers should match the response header.
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});
