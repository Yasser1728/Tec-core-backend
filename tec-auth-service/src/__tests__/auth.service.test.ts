import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../modules/auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';

// ── Mock axios ────────────────────────────────────────────
jest.mock('axios', () => ({
  get: jest.fn(),
  isAxiosError: jest.fn(),
}));

// ── Mock ioredis ──────────────────────────────────────────
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on:     jest.fn(),
    xadd:   jest.fn().mockResolvedValue('msg-001'),
    get:    jest.fn().mockResolvedValue(null),
    setex:  jest.fn().mockResolvedValue('OK'),
    status: 'ready',
  }));
});

import axios from 'axios';

const mockPrisma = {
  user: {
    findUnique:  jest.fn(),
    findFirst:   jest.fn(),
    create:      jest.fn(),
    upsert:      jest.fn(),
  },
};

const mockJwt = {
  sign:   jest.fn().mockReturnValue('mock-token'),
  verify: jest.fn(),
  decode: jest.fn(),
};

const mockConfig = {
  get: jest.fn().mockImplementation((key: string) => {
    const values: Record<string, string> = {
      JWT_SECRET:          'test-secret',
      JWT_REFRESH_SECRET:  'test-refresh-secret',
      JWT_EXPIRES_IN:      '86400',
      JWT_REFRESH_EXPIRES_IN: '604800',
    };
    return values[key] ?? null;
  }),
};

const baseUser = {
  id:           'user-001',
  pi_uid:       'pi-uid-001',
  pi_username:  'testuser',
  role:         'user',
  email:        null,
  password_hash: null,
  kyc_status:   'pending',
  created_at:   new Date(),
};

let service: AuthService;

beforeEach(async () => {
  jest.clearAllMocks();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaService,  useValue: mockPrisma },
      { provide: JwtService,     useValue: mockJwt    },
      { provide: ConfigService,  useValue: mockConfig  },
    ],
  }).compile();

  service = module.get<AuthService>(AuthService);
});

// ═══════════════════════════════════════════════════════════
describe('AuthService — piLogin', () => {

  it('logs in existing Pi user', async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      data: { uid: 'pi-uid-001', username: 'testuser' },
    });
    mockPrisma.user.findUnique.mockResolvedValue(baseUser);
    mockPrisma.user.upsert.mockResolvedValue(baseUser);

    const result = await service.piLogin('valid-pi-token');

    expect(result.success).toBe(true);
    expect(result.user.piUsername).toBe('testuser');
    expect(result.tokens.accessToken).toBe('mock-token');
    expect(result.isNewUser).toBe(false);
  });

  it('creates new user on first login', async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      data: { uid: 'pi-uid-new', username: 'newuser' },
    });
    mockPrisma.user.findUnique.mockResolvedValue(null); // مستخدم جديد
    mockPrisma.user.upsert.mockResolvedValue({ ...baseUser, pi_uid: 'pi-uid-new', pi_username: 'newuser' });

    const result = await service.piLogin('valid-pi-token');

    expect(result.isNewUser).toBe(true);
    expect(result.user.piUsername).toBe('newuser');
  });

  it('throws BadRequestException for empty token', async () => {
    await expect(service.piLogin('')).rejects.toThrow(BadRequestException);
  });

  it('throws UnauthorizedException for invalid Pi token', async () => {
    (axios.isAxiosError as jest.Mock).mockReturnValue(true);
    (axios.get as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      response:     { status: 401 },
    });

    await expect(service.piLogin('invalid-token')).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when Pi returns empty response', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: {} });
    (axios.isAxiosError as jest.Mock).mockReturnValue(false);

    await expect(service.piLogin('bad-token')).rejects.toThrow(UnauthorizedException);
  });

  it('returns correct token structure', async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      data: { uid: 'pi-uid-001', username: 'testuser' },
    });
    mockPrisma.user.findUnique.mockResolvedValue(baseUser);
    mockPrisma.user.upsert.mockResolvedValue(baseUser);

    const result = await service.piLogin('valid-token');

    expect(result.tokens).toHaveProperty('accessToken');
    expect(result.tokens).toHaveProperty('refreshToken');
    expect(mockJwt.sign).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════
describe('AuthService — register', () => {

  it('registers new user with email', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      ...baseUser,
      email: 'test@example.com',
    });

    const result = await service.register({
      email:    'test@example.com',
      password: 'password123',
    });

    expect(result.success).toBe(true);
    expect(result.isNewUser).toBe(true);
  });

  it('throws ConflictException for existing user', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(baseUser);

    await expect(
      service.register({ email: 'existing@example.com', password: 'pass' })
    ).rejects.toThrow(ConflictException);
  });

  it('throws BadRequestException with no credentials', async () => {
    await expect(service.register({})).rejects.toThrow(BadRequestException);
  });

  it('registers with Pi UID', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ ...baseUser, pi_uid: 'new-pi-uid' });

    const result = await service.register({ pi_uid: 'new-pi-uid' });

    expect(result.success).toBe(true);
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pi_uid: 'new-pi-uid' }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════
describe('AuthService — login', () => {

  it('logs in with Pi UID', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(baseUser);

    const result = await service.login({ pi_uid: 'pi-uid-001' });

    expect(result.success).toBe(true);
    expect(result.isNewUser).toBe(false);
  });

  it('throws UnauthorizedException for missing Pi user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(service.login({ pi_uid: 'unknown' })).rejects.toThrow(UnauthorizedException);
  });

  it('throws BadRequestException with no credentials', async () => {
    await expect(service.login({})).rejects.toThrow(BadRequestException);
  });

  it('throws UnauthorizedException for wrong password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...baseUser,
      email:         'test@example.com',
      password_hash: '$2b$12$invalid_hash',
    });

    await expect(
      service.login({ email: 'test@example.com', password: 'wrongpassword' })
    ).rejects.toThrow(UnauthorizedException);
  });
});

// ═══════════════════════════════════════════════════════════
describe('AuthService — validateToken', () => {

  it('returns payload for valid token', async () => {
    const payload = { sub: 'user-001', pi_username: 'testuser' };
    mockJwt.verify.mockReturnValue(payload);

    const result = await service.validateToken('valid-token');

    expect(result.sub).toBe('user-001');
  });

  it('throws UnauthorizedException for expired token', async () => {
    mockJwt.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    await expect(service.validateToken('expired-token')).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for malformed token', async () => {
    mockJwt.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    await expect(service.validateToken('bad-token')).rejects.toThrow(UnauthorizedException);
  });
});

// ═══════════════════════════════════════════════════════════
describe('AuthService — getMe', () => {

  it('returns user data', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id:          'user-001',
      pi_uid:      'pi-uid-001',
      pi_username: 'testuser',
      kyc_status:  'pending',
      role:        'user',
      created_at:  new Date(),
    });

    const result = await service.getMe('user-001');

    expect(result.id).toBe('user-001');
    expect(result.pi_username).toBe('testuser');
  });

  it('throws UnauthorizedException for non-existent user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(service.getMe('user-999')).rejects.toThrow(UnauthorizedException);
  });
});

// ═══════════════════════════════════════════════════════════
describe('AuthService — refreshToken', () => {

  it('returns new access token for valid refresh token', async () => {
    const payload = { sub: 'user-001', type: 'refresh', exp: Math.floor(Date.now() / 1000) + 3600 };
    mockJwt.verify.mockReturnValue(payload);
    mockPrisma.user.findUnique.mockResolvedValue(baseUser);

    const result = await service.refreshToken('valid-refresh-token');

    expect(result.token).toBe('mock-token');
  });

  it('throws UnauthorizedException for expired refresh token', async () => {
    mockJwt.verify.mockImplementation(() => { throw new Error('expired'); });

    await expect(service.refreshToken('expired-token')).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for non-refresh token type', async () => {
    mockJwt.verify.mockReturnValue({ sub: 'user-001', type: 'access' });

    await expect(service.refreshToken('access-token')).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for blacklisted token', async () => {
    const payload = { sub: 'user-001', type: 'refresh', exp: Math.floor(Date.now() / 1000) + 3600 };
    mockJwt.verify.mockReturnValue(payload);

    // Mock Redis get — blacklisted
    const Redis = require('ioredis');
    const redisInstance = new Redis();
    (redisInstance.get as jest.Mock).mockResolvedValue('1');

    // Re-create service with blacklisted redis mock
    process.env.REDIS_URL = 'redis://localhost:6379';
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService,    useValue: mockJwt   },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    const newService = module.get<AuthService>(AuthService);
    delete process.env.REDIS_URL;

    await expect(newService.refreshToken('blacklisted-token')).rejects.toThrow(UnauthorizedException);
  });
});

// ═══════════════════════════════════════════════════════════
describe('AuthService — logout', () => {

  it('returns success true', async () => {
    mockJwt.decode.mockReturnValue({
      sub: 'user-001',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await service.logout('valid-token');

    expect(result.success).toBe(true);
  });

  it('returns success true even for invalid token', async () => {
    mockJwt.decode.mockReturnValue(null);

    const result = await service.logout('garbage');

    expect(result.success).toBe(true);
  });
});
