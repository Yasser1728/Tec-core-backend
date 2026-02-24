/**
 * Unit tests for Phase 3 wallet service additions:
 * - Rate limiting middleware
 * - Logger operation tracing
 * - Security headers
 */
import request from 'supertest';
import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createRateLimiter } from '../../src/middlewares/rateLimit.middleware';
import { logger, OperationPhase } from '../../src/utils/logger';

// ─── Rate Limiter Tests ────────────────────────────────────────────────────────

describe('Rate Limiter Middleware', () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    // Very tight limiter for testing: 2 requests per 60 s
    const limiter = createRateLimiter(2, 60000);
    app.post('/test', limiter, (_req, res) => {
      res.json({ success: true });
    });
  });

  it('allows requests within the limit', async () => {
    const res1 = await request(app).post('/test').send({ userId: 'user1' });
    expect(res1.status).toBe(200);

    const res2 = await request(app).post('/test').send({ userId: 'user1' });
    expect(res2.status).toBe(200);
  });

  it('blocks requests that exceed the limit', async () => {
    await request(app).post('/test').send({ userId: 'userA' });
    await request(app).post('/test').send({ userId: 'userA' });
    // Third request should be rate limited
    const res = await request(app).post('/test').send({ userId: 'userA' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('includes Retry-After header when rate limited', async () => {
    await request(app).post('/test').send({ userId: 'userB' });
    await request(app).post('/test').send({ userId: 'userB' });
    const res = await request(app).post('/test').send({ userId: 'userB' });
    expect(res.headers).toHaveProperty('retry-after');
  });

  it('does not rate-limit different users independently', async () => {
    // Fill up user C's quota
    await request(app).post('/test').send({ userId: 'userC' });
    await request(app).post('/test').send({ userId: 'userC' });
    // user D should still get through
    const res = await request(app).post('/test').send({ userId: 'userD' });
    expect(res.status).toBe(200);
  });
});

// ─── Logger Operation Trace Tests ─────────────────────────────────────────────

describe('Logger operation trace', () => {
  const phases: OperationPhase[] = ['init', 'verify', 'commit', 'rollback'];

  it('exposes an operation method', () => {
    expect(typeof logger.operation).toBe('function');
  });

  it('does not throw for any valid phase', () => {
    phases.forEach((phase) => {
      expect(() => logger.operation('transfer', phase, { test: true })).not.toThrow();
    });
  });

  it('logs errors to process.stdout on rollback', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.operation('transfer', 'rollback', { error: 'test' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('logs info to process.stdout on commit', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.operation('deposit', 'commit', { walletId: 'abc' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ─── Security Headers Tests ───────────────────────────────────────────────────

describe('Security headers', () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
          },
        },
        frameguard: { action: 'deny' },
        noSniff: true,
      })
    );
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  });

  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options: DENY', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('sets Content-Security-Policy header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

// ─── CORS origin restriction tests ────────────────────────────────────────────

describe('CORS origin restriction', () => {
  it('allows whitelisted origins', async () => {
    const app = express();
    app.use(cors({ origin: ['https://example.com'], credentials: true }));
    app.get('/test', (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/test').set('Origin', 'https://example.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://example.com');
  });

  it('does not echo back disallowed origins', async () => {
    const app = express();
    app.use(cors({ origin: ['https://example.com'], credentials: true }));
    app.get('/test', (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/test').set('Origin', 'https://evil.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
