import { Test, TestingModule }          from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { KycService }                   from '../modules/kyc/kyc.service';
import { PrismaService }                from '../prisma/prisma.service';

// ── Prisma Mock ───────────────────────────────────────────────
const mockKyc = {
  id:               'kyc-uuid-1',
  user_id:          'user-uuid-1',
  pi_user_id:       'pi-uuid-1',
  username:         'testuser',
  status:           'NOT_STARTED',
  level:            'L0',
  id_front_url:     null,
  id_back_url:      null,
  selfie_url:       null,
  submitted_at:     null,
  verified_at:      null,
  rejected_at:      null,
  rejection_reason: null,
  audit_logs:       [],
  created_at:       new Date(),
  updated_at:       new Date(),
};

const prismaMock = {
  kyc: {
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
  },
  kycAuditLog: {
    create: jest.fn(),
  },
};

// ── Tests ─────────────────────────────────────────────────────
describe('KycService', () => {
  let service: KycService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<KycService>(KycService);
    jest.clearAllMocks();
    prismaMock.kycAuditLog.create.mockResolvedValue({});
  });

  // ── getOrCreate ─────────────────────────────────────────────
  describe('getOrCreate', () => {
    it('returns existing KYC record', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue(mockKyc);

      const result = await service.getOrCreate('user-uuid-1');

      expect(result).toEqual(mockKyc);
      expect(prismaMock.kyc.create).not.toHaveBeenCalled();
    });

    it('creates new KYC record if not found', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue(null);
      prismaMock.kyc.create.mockResolvedValue(mockKyc);

      const result = await service.getOrCreate('user-uuid-1', {
        piUserId: 'pi-uuid-1',
        username: 'testuser',
      });

      expect(prismaMock.kyc.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'user-uuid-1',
            status:  'NOT_STARTED',
            level:   'L0',
          }),
        }),
      );
      expect(result).toEqual(mockKyc);
    });
  });

  // ── startKyc ────────────────────────────────────────────────
  describe('startKyc', () => {
    it('starts KYC for NOT_STARTED user', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue(mockKyc);
      prismaMock.kyc.update.mockResolvedValue({ ...mockKyc, status: 'NOT_STARTED' });

      const result = await service.startKyc('user-uuid-1');

      expect(result.status).toBe('NOT_STARTED');
    });

    it('throws if KYC already VERIFIED', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue({ ...mockKyc, status: 'VERIFIED' });

      await expect(service.startKyc('user-uuid-1'))
        .rejects.toThrow(BadRequestException);
    });

    it('throws if KYC already PENDING', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue({ ...mockKyc, status: 'PENDING' });

      await expect(service.startKyc('user-uuid-1'))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── uploadDocuments ──────────────────────────────────────────
  describe('uploadDocuments', () => {
    it('uploads documents successfully', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue(mockKyc);
      prismaMock.kyc.update.mockResolvedValue({
        ...mockKyc,
        id_front_url: 'https://storage/front.jpg',
        selfie_url:   'https://storage/selfie.jpg',
      });

      const result = await service.uploadDocuments('user-uuid-1', {
        idFrontUrl: 'https://storage/front.jpg',
        selfieUrl:  'https://storage/selfie.jpg',
      });

      expect(result.id_front_url).toBe('https://storage/front.jpg');
      expect(prismaMock.kyc.update).toHaveBeenCalled();
    });

    it('throws if KYC already VERIFIED', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue({ ...mockKyc, status: 'VERIFIED' });

      await expect(service.uploadDocuments('user-uuid-1', { idFrontUrl: 'url' }))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── submitKyc ────────────────────────────────────────────────
  describe('submitKyc', () => {
    it('submits KYC when documents are uploaded', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue({
        ...mockKyc,
        id_front_url: 'https://storage/front.jpg',
        selfie_url:   'https://storage/selfie.jpg',
      });
      prismaMock.kyc.update.mockResolvedValue({
        ...mockKyc,
        status: 'PENDING',
      });

      const result = await service.submitKyc('user-uuid-1');

      expect(result.status).toBe('PENDING');
    });

    it('throws if documents are missing', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue({
        ...mockKyc,
        id_front_url: null,
        selfie_url:   null,
      });

      await expect(service.submitKyc('user-uuid-1'))
        .rejects.toThrow(BadRequestException);
    });

    it('throws if already VERIFIED', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue({ ...mockKyc, status: 'VERIFIED' });

      await expect(service.submitKyc('user-uuid-1'))
        .rejects.toThrow(BadRequestException);
    });

    it('throws if already PENDING', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue({ ...mockKyc, status: 'PENDING' });

      await expect(service.submitKyc('user-uuid-1'))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── verifyKyc ────────────────────────────────────────────────
  describe('verifyKyc', () => {
    it('verifies KYC with L1 level', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue({ ...mockKyc, status: 'PENDING' });
      prismaMock.kyc.update.mockResolvedValue({
        ...mockKyc,
        status: 'VERIFIED',
        level:  'L1',
      });

      const result = await service.verifyKyc('user-uuid-1', 'L1');

      expect(result.status).toBe('VERIFIED');
      expect(result.level).toBe('L1');
    });

    it('throws NotFoundException if KYC not found', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue(null);

      await expect(service.verifyKyc('user-uuid-1'))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── rejectKyc ────────────────────────────────────────────────
  describe('rejectKyc', () => {
    it('rejects KYC with reason', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue({ ...mockKyc, status: 'PENDING' });
      prismaMock.kyc.update.mockResolvedValue({
        ...mockKyc,
        status:           'REJECTED',
        rejection_reason: 'Documents unclear',
      });

      const result = await service.rejectKyc('user-uuid-1', 'Documents unclear');

      expect(result.status).toBe('REJECTED');
      expect(result.rejection_reason).toBe('Documents unclear');
    });

    it('throws NotFoundException if KYC not found', async () => {
      prismaMock.kyc.findUnique.mockResolvedValue(null);

      await expect(service.rejectKyc('user-uuid-1', 'reason'))
        .rejects.toThrow(NotFoundException);
    });
  });
});
