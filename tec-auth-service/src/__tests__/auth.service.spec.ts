import { Test, TestingModule }  from '@nestjs/testing';
import {
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService }           from '@nestjs/jwt';
import { ConfigService }        from '@nestjs/config';
import { AuthService }          from '../modules/auth/auth.service';
import { PrismaService }        from '../../prisma/prisma.service';
import axios                    from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ── Mock Data ─────────────────────────────────────────────────
const mockUser = {
  id:           'user-uuid-1',
  pi_uid:       'pi-uid-1',
  pi_username:  'testuser',
  email:        null,
  password_hash: null,
  role:         'user',
  kyc_status:   'PENDING',
  created_at:   new Date(),
};

const prismaMock = {
  user: {
    findUnique: jest.fn(),
    findFirst:  jest.fn(),
    upsert:     jest.fn(),
    create:     jest.fn(),
  },
};

const jwtMock = {
  sign:   jest.fn().mockReturnValue('mock-token'),
  verify: jest.fn().mockReturnValue({ sub: 'user-uuid-1', type: 'access' }),
  decode: jest.fn().mockReturnValue({ sub: 'user-uuid-1', exp: Math.floor(Date.now() / 1000) + 3600 }),
};

const configMock = {
  getOrThrow: jest.fn().mockReturnValue('test-jwt-secret-32-characters-long'),
  get:        jest.fn().mockReturnValue(undefined),
};

// ── Tests ─────────────────────────────────────────────────────
describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService,  useValue: prismaMock  },
        { provide: JwtService,     useValue: jwtMock     },
        { provide: ConfigService,  useValue: configMock  },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    jwtMock.sign.mockReturnValue('mock-token');
    configMock.getOrThrow.mockReturnValue('test-jwt-secret-32-characters-long');
    configMock.get.mockReturnValue(undefined);
  });

  // ── piLogin ───────────────────────────────────────────────────
  describe('piLogin', () => {
    it('logs in existing Pi user', async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { uid: 'pi-uid-1', username: 'testuser' },
      });
      prismaMock.user.findUnique.mockResolvedValue(mockUser);
      prismaMock.user.upsert.mockResolvedValue(mockUser);

      const result = await service.piLogin('valid-pi-token');

      expect(result.success).toBe(true);
      expect(result.isNewUser).toBe(false);
      expect(result.tokens.accessToken).toBe('mock-token');
    });

    it('creates new user on first Pi login', async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { uid: 'pi-uid-new', username: 'newuser' },
      });
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.upsert.mockResolvedValue({ ...mockUser, pi_uid: 'pi-uid-new' });

      const result = await service.piLogin('valid-pi-token');

      expect(result.isNewUser).toBe(true);
    });

    it('throws BadRequestException when token is empty', async () => {
      await expect(service.piLogin('')).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException when Pi API returns 401', async () => {
      mockedAxios.get = jest.fn().mockRejectedValue({
        isAxiosError: true,
        response:     { status: 401 },
      });
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);

      await expect(service.piLogin('invalid-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── register ──────────────────────────────────────────────────
  describe('register', () => {
    it('registers new user with email', async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(mockUser);

      const result = await service.register({
        email:    'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(true);
      expect(result.isNewUser).toBe(true);
    });

    it('throws ConflictException if user already exists', async () => {
      prismaMock.user.findFirst.mockResolvedValue(mockUser);

      await expect(
        service.register({ email: 'test@example.com', password: 'pass' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException if no email or pi_uid', async () => {
      await expect(service.register({})).rejects.toThrow(BadRequestException);
    });
  });

  // ── login ─────────────────────────────────────────────────────
  describe('login', () => {
    it('logs in with Pi UID', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.login({ pi_uid: 'pi-uid-1' });

      expect(result.success).toBe(true);
    });

    it('throws UnauthorizedException when Pi user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.login({ pi_uid: 'non-existent' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException with no credentials', async () => {
      await expect(service.login({})).rejects.toThrow(BadRequestException);
    });
  });

  // ── validateToken ─────────────────────────────────────────────
  describe('validateToken', () => {
    it('returns payload for valid token', async () => {
      jwtMock.verify.mockReturnValue({ sub: 'user-uuid-1' });

      const result = await service.validateToken('valid-token');

      expect(result.sub).toBe('user-uuid-1');
    });

    it('throws UnauthorizedException for invalid token', async () => {
      jwtMock.verify.mockImplementation(() => { throw new Error('invalid'); });

      await expect(service.validateToken('bad-token'))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  // ── getMe ─────────────────────────────────────────────────────
  describe('getMe', () => {
    it('returns user data', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getMe('user-uuid-1');

      expect(result).toEqual(mockUser);
    });

    it('throws UnauthorizedException when user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.getMe('non-existent'))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  // ── logout ────────────────────────────────────────────────────
  describe('logout', () => {
    it('returns success when Redis not configured', async () => {
      const result = await service.logout('some-token');
      expect(result.success).toBe(true);
    });
  });
});
