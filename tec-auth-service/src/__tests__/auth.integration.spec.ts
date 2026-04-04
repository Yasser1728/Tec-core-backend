import { Test, TestingModule }   from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule }             from '@nestjs/jwt';
import { ConfigModule }          from '@nestjs/config';
import request                   from 'supertest';
import { AuthController }        from '../modules/auth/auth.controller';
import { AuthService }           from '../modules/auth/auth.service';
import { PrismaService }         from '../../prisma/prisma.service';

// ── Mocks ─────────────────────────────────────────────────
const mockUser = {
  id:          'user-uuid-1',
  pi_uid:      'pi-uid-1',
  pi_username: 'testuser',
  role:        'user',
  kyc_status:  'PENDING',
  created_at:  new Date(),
};

const mockAuthResponse = {
  success:   true,
  isNewUser: false,
  user: {
    id:               mockUser.id,
    piId:             mockUser.pi_uid,
    piUsername:       mockUser.pi_username,
    role:             mockUser.role,
    subscriptionPlan: null,
    createdAt:        mockUser.created_at.toISOString(),
  },
  tokens: {
    accessToken:  'mock-access-token',
    refreshToken: 'mock-refresh-token',
  },
};

const authServiceMock = {
  piLogin:       jest.fn().mockResolvedValue(mockAuthResponse),
  register:      jest.fn().mockResolvedValue({ ...mockAuthResponse, isNewUser: true }),
  login:         jest.fn().mockResolvedValue(mockAuthResponse),
  refreshToken:  jest.fn().mockResolvedValue({ token: 'new-access-token' }),
  logout:        jest.fn().mockResolvedValue({ success: true }),
  validateToken: jest.fn().mockResolvedValue({ sub: mockUser.id }),
  getMe:         jest.fn().mockResolvedValue(mockUser),
};

const prismaMock = {
  user: { findUnique: jest.fn(), upsert: jest.fn(), create: jest.fn() },
};

// ── Tests ─────────────────────────────────────────────────
describe('AuthController (Integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        JwtModule.register({ secret: 'test-secret', signOptions: { expiresIn: '1d' } }),
      ],
      controllers: [AuthController],
      providers: [
        { provide: AuthService,   useValue: authServiceMock },
        { provide: PrismaService, useValue: prismaMock      },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authServiceMock.piLogin.mockResolvedValue(mockAuthResponse);
    authServiceMock.register.mockResolvedValue({ ...mockAuthResponse, isNewUser: true });
    authServiceMock.login.mockResolvedValue(mockAuthResponse);
    authServiceMock.refreshToken.mockResolvedValue({ token: 'new-access-token' });
    authServiceMock.logout.mockResolvedValue({ success: true });
    authServiceMock.validateToken.mockResolvedValue({ sub: mockUser.id });
    authServiceMock.getMe.mockResolvedValue(mockUser);
  });

  // ── GET /health ────────────────────────────────────────
  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', service: 'auth' });
    });
  });

  // ── POST /pi-login ─────────────────────────────────────
  describe('POST /pi-login', () => {
    it('returns 200 with tokens on valid Pi token', async () => {
      const res = await request(app.getHttpServer())
        .post('/pi-login')
        .send({ accessToken: 'valid-pi-token' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tokens.accessToken).toBe('mock-access-token');
      expect(authServiceMock.piLogin).toHaveBeenCalledWith('valid-pi-token');
    });

    it('returns 400 when accessToken is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/pi-login')
        .send({});

      expect(res.status).toBe(400);
    });

    it('marks isNewUser true for new users', async () => {
      authServiceMock.piLogin.mockResolvedValue({ ...mockAuthResponse, isNewUser: true });

      const res = await request(app.getHttpServer())
        .post('/pi-login')
        .send({ accessToken: 'new-user-token' });

      expect(res.status).toBe(200);
      expect(res.body.isNewUser).toBe(true);
    });
  });

  // ── POST /register ─────────────────────────────────────
  describe('POST /register', () => {
    it('returns 201 on successful registration', async () => {
      const res = await request(app.getHttpServer())
        .post('/register')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(201);
      expect(res.body.isNewUser).toBe(true);
    });
  });

  // ── POST /login ────────────────────────────────────────
  describe('POST /login', () => {
    it('returns 200 on valid Pi UID login', async () => {
      const res = await request(app.getHttpServer())
        .post('/login')
        .send({ pi_uid: 'pi-uid-1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── POST /refresh ──────────────────────────────────────
  describe('POST /refresh', () => {
    it('returns 200 with new token', async () => {
      const res = await request(app.getHttpServer())
        .post('/refresh')
        .set('Authorization', 'Bearer mock-refresh-token');

      expect(res.status).toBe(200);
      expect(res.body.token).toBe('new-access-token');
    });

    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/refresh');

      expect(res.status).toBe(401);
    });

    it('returns 401 when token format is wrong', async () => {
      const res = await request(app.getHttpServer())
        .post('/refresh')
        .set('Authorization', 'InvalidFormat token');

      expect(res.status).toBe(401);
    });
  });

  // ── POST /logout ───────────────────────────────────────
  describe('POST /logout', () => {
    it('returns 200 on successful logout', async () => {
      const res = await request(app.getHttpServer())
        .post('/logout')
        .set('Authorization', 'Bearer mock-access-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/logout');

      expect(res.status).toBe(401);
    });
  });

  // ── GET /me ────────────────────────────────────────────
  describe('GET /me', () => {
    it('returns 200 with user data', async () => {
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', 'Bearer mock-access-token');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(mockUser.id);
      expect(res.body.pi_username).toBe(mockUser.pi_username);
    });

    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app.getHttpServer())
        .get('/me');

      expect(res.status).toBe(401);
    });
  });
});
