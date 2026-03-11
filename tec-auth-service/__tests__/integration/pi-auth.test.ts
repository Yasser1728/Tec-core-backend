import request from 'supertest';
import express from 'express';
import { body } from 'express-validator';

// ── Environment setup (must precede module imports) ──────────────────────────
process.env.JWT_SECRET = 'test-jwt-secret-for-pi-auth-tests';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-pi-auth-tests';
process.env.NODE_ENV = 'test';
// Existing tests exercise the Mainnet path (they mock fetch); disable sandbox mode.
process.env.PI_SANDBOX = 'false';

// ── Mock Prisma client ───────────────────────────────────────────────────────
const mockUser = {
  id: 'user-uuid-123',
  pi_uid: 'pi-uid-abc',
  pi_username: 'testpiuser',
  email: null,
  password_hash: null,
  kyc_status: 'pending',
  role: 'user',
  created_at: new Date(),
  updated_at: new Date(),
};

const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn().mockResolvedValue({}),
  },
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

// ── Import controller after mocks are registered ─────────────────────────────
import { piLogin } from '../../src/controllers/pi-auth.controller';

// ── Build a minimal test app ─────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.post('/auth/pi-login', [body('accessToken').notEmpty()], piLogin);

// ── Helpers ──────────────────────────────────────────────────────────────────
const mockFetch = (status: number, body: unknown) => {
  global.fetch = jest.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
};

describe('POST /auth/pi-login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.refreshToken.create.mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 400 when accessToken is missing', async () => {
    const res = await request(app).post('/auth/pi-login').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when Pi Network API rejects the token (401)', async () => {
    mockFetch(401, { error: 'invalid_token' });

    const res = await request(app)
      .post('/auth/pi-login')
      .send({ accessToken: 'bad-token' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 503 when Pi Network API is unreachable (network error)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const res = await request(app)
      .post('/auth/pi-login')
      .send({ accessToken: 'any-token' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('PI_SERVICE_UNAVAILABLE');
  });

  it('returns 201 and creates a new user on first-time Pi login', async () => {
    mockFetch(200, { uid: 'pi-uid-new', username: 'newpiuser' });
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      ...mockUser,
      id: 'new-user-uuid',
      pi_uid: 'pi-uid-new',
      pi_username: 'newpiuser',
    });

    const res = await request(app)
      .post('/auth/pi-login')
      .send({ accessToken: 'valid-pi-token' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isNewUser).toBe(true);
    expect(res.body.data.tokens).toHaveProperty('accessToken');
    expect(res.body.data.tokens).toHaveProperty('refreshToken');
    expect(res.body.data.user.piUid).toBe('pi-uid-new');
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    // username must NOT be passed — column does not exist in production DB
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ username: expect.anything() }),
      })
    );
  });

  it('returns 200 for a returning Pi user', async () => {
    mockFetch(200, { uid: mockUser.pi_uid, username: mockUser.pi_username });
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/auth/pi-login')
      .send({ accessToken: 'valid-pi-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isNewUser).toBe(false);
    expect(res.body.data.tokens).toHaveProperty('accessToken');
    expect(res.body.data.user.piUid).toBe(mockUser.pi_uid);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('updates pi_username when it differs from stored value', async () => {
    const updatedUsername = 'updated_pi_username';
    mockFetch(200, { uid: mockUser.pi_uid, username: updatedUsername });
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      pi_username: updatedUsername,
    });

    const res = await request(app)
      .post('/auth/pi-login')
      .send({ accessToken: 'valid-pi-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pi_username: updatedUsername }),
      })
    );
  });

  it('returns 500 DB_SCHEMA_MISMATCH when Prisma throws P2022', async () => {
    mockFetch(200, { uid: 'pi-uid-new', username: 'newpiuser' });
    mockPrisma.user.findFirst.mockResolvedValue(null);
    const p2022Error = Object.assign(new Error('P2022'), { code: 'P2022' });
    mockPrisma.user.create.mockRejectedValue(p2022Error);

    const res = await request(app)
      .post('/auth/pi-login')
      .send({ accessToken: 'valid-pi-token' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('DB_SCHEMA_MISMATCH');
  });
});

// ── Sandbox / Testnet mode tests ─────────────────────────────────────────────
describe('POST /auth/pi-login (sandbox mode)', () => {
  const origSandbox = process.env.PI_SANDBOX;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.refreshToken.create.mockResolvedValue({});
    process.env.PI_SANDBOX = 'true';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.PI_SANDBOX = origSandbox;
  });

  it('decodes a valid Pi JWT and logs in without calling fetch', async () => {
    // Build a minimal JWT-shaped token with uid and username in the payload
    const payload = Buffer.from(JSON.stringify({ uid: 'sandbox-pi-uid', username: 'sbuser' })).toString('base64url');
    const fakeJwt = `header.${payload}.sig`;

    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      ...mockUser,
      id: 'sb-user-uuid',
      pi_uid: 'sandbox-pi-uid',
      pi_username: 'sbuser',
    });

    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    const res = await request(app).post('/auth/pi-login').send({ accessToken: fakeJwt });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.piUid).toBe('sandbox-pi-uid');
    expect(res.body.data.isNewUser).toBe(true);
  });

  it('derives a stable sandbox uid for non-JWT opaque tokens', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      ...mockUser,
      id: 'opaque-sb-uuid',
      pi_uid: 'sandbox_opaque',
      pi_username: 'sandbox_user',
    });

    const res = await request(app).post('/auth/pi-login').send({ accessToken: 'opaque-token-no-dots' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    // uid was derived via hash — we just confirm the response is well-formed
    expect(res.body.data.tokens).toHaveProperty('accessToken');
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    const createCall = mockPrisma.user.create.mock.calls[0][0];
    expect(createCall.data.pi_uid).toMatch(/^sandbox_[0-9a-f]{16}$/);
  });
});
