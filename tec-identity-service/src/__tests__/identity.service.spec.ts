import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException }   from '@nestjs/common';
import { IdentityService }     from '../modules/identity/identity.service';
import { PrismaService }       from '../prisma/prisma.service';

// ── Mock Data ─────────────────────────────────────────────────
const mockUser = {
  id:          'user-uuid-1',
  pi_user_id:  'pi-uuid-1',
  username:    'testuser',
  created_at:  new Date(),
  updated_at:  new Date(),
  profile: {
    id:           'profile-uuid-1',
    user_id:      'user-uuid-1',
    display_name: 'testuser',
    bio:          null,
    country:      null,
    language:     'en',
    avatar_url:   null,
  },
  kyc: {
    id:      'kyc-uuid-1',
    user_id: 'user-uuid-1',
    status:  'PENDING',
    level:   'L1',
  },
  roles: [{ role: { name: 'USER' } }],
};

const mockKyc = {
  id:      'kyc-uuid-1',
  user_id: 'user-uuid-1',
  status:  'PENDING',
  level:   'L1',
};

const mockProfile = {
  id:           'profile-uuid-1',
  user_id:      'user-uuid-1',
  display_name: 'Updated Name',
  bio:          'My bio',
  country:      'SA',
  language:     'ar',
  avatar_url:   null,
};

const prismaMock = {
  user: {
    findUnique: jest.fn(),
    create:     jest.fn(),
  },
  profile: {
    upsert: jest.fn(),
  },
  kyc: {
    findUnique: jest.fn(),
  },
};

// ── Tests ─────────────────────────────────────────────────────
describe('IdentityService', () => {
  let service: IdentityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<IdentityService>(IdentityService);
    jest.clearAllMocks();
  });

  // ── findOrCreateUser ──────────────────────────────────────────
  describe('findOrCreateUser', () => {
    it('returns existing user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findOrCreateUser({
        piUserId: 'pi-uuid-1',
        username: 'testuser',
      });

      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(result).toEqual(mockUser);
    });

    it('creates new user when not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(mockUser);

      const result = await service.findOrCreateUser({
        piUserId: 'pi-uuid-1',
        username: 'testuser',
      });

      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pi_user_id: 'pi-uuid-1',
            username:   'testuser',
          }),
        }),
      );
      expect(result).toEqual(mockUser);
    });

    it('creates user with profile and kyc', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(mockUser);

      await service.findOrCreateUser({
        piUserId: 'pi-uuid-1',
        username: 'testuser',
      });

      const createCall = prismaMock.user.create.mock.calls[0][0];
      expect(createCall.data.profile.create).toBeDefined();
      expect(createCall.data.kyc.create).toBeDefined();
      expect(createCall.data.roles.create).toBeDefined();
    });
  });

  // ── getProfile ────────────────────────────────────────────────
  describe('getProfile', () => {
    it('returns user profile', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getProfile('user-uuid-1');

      expect(result).toEqual(mockUser);
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-uuid-1' },
        }),
      );
    });

    it('throws NotFoundException when user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('non-existent'))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── updateProfile ─────────────────────────────────────────────
  describe('updateProfile', () => {
    it('updates profile successfully', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser);
      prismaMock.profile.upsert.mockResolvedValue(mockProfile);

      const result = await service.updateProfile('user-uuid-1', {
        displayName: 'Updated Name',
        bio:         'My bio',
        country:     'SA',
        language:    'ar',
      });

      expect(prismaMock.profile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where:  { user_id: 'user-uuid-1' },
          update: expect.objectContaining({
            display_name: 'Updated Name',
          }),
        }),
      );
      expect(result.display_name).toBe('Updated Name');
    });

    it('throws NotFoundException when user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProfile('non-existent', { displayName: 'Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates profile if not exists', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser);
      prismaMock.profile.upsert.mockResolvedValue(mockProfile);

      await service.updateProfile('user-uuid-1', {
        displayName: 'New Name',
      });

      const upsertCall = prismaMock.profile.upsert.mock.calls[0][0];
      expect(upsertCall.create).toBeDefined();
      expect(upsertCall.create.user_id).toBe('user-uuid-1');
    });
  });

  // ── getKycStatus ──────────────────────────────────────────────
  describe('getKycStatus', () => {
    it('returns KYC record', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue(mockKyc);

      const result = await service.getKycStatus('user-uuid-1');

      expect(result).toEqual(mockKyc);
      expect(prismaMock.kyc.findUnique).toHaveBeenCalledWith({
        where: { user_id: 'user-uuid-1' },
      });
    });

    it('throws NotFoundException when KYC not found', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue(null);

      await expect(service.getKycStatus('non-existent'))
        .rejects.toThrow(NotFoundException);
    });
  });
});
