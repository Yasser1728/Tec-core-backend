import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { KycService } from '../src/modules/kyc/kyc.service';
import { PrismaService } from '../src/prisma/prisma.service';

// ── Mock Redis ────────────────────────────────────────────────
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    xadd: jest.fn().mockResolvedValue('1234-0'),
    quit: jest.fn().mockResolvedValue('OK'),
  }));
});

// ── Mock Prisma ───────────────────────────────────────────────
const mockPrisma = {
  kyc: {
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
  },
  kycAuditLog: {
    create: jest.fn(),
  },
};

const baseKyc = {
  id:           'kyc-123',
  user_id:      'user-456',
  pi_user_id:   'pi-789',
  username:     'testuser',
  status:       'NOT_STARTED',
  level:        'L0',
  id_front_url: null,
  id_back_url:  null,
  selfie_url:   null,
  audit_logs:   [],
};

let service: KycService;

beforeEach(async () => {
  jest.clearAllMocks();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      KycService,
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();

  service = module.get<KycService>(KycService);
});

// ══════════════════════════════════════════════════════════════
describe('KycService — getOrCreate', () => {

  it('returns existing KYC record', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue(baseKyc);
    const result = await service.getOrCreate('user-456');
    expect(result).toEqual(baseKyc);
    expect(mockPrisma.kyc.create).not.toHaveBeenCalled();
  });

  it('creates new KYC record when none exists', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue(null);
    mockPrisma.kyc.create.mockResolvedValue(baseKyc);
    const result = await service.getOrCreate('user-456', { piUserId: 'pi-789', username: 'testuser' });
    expect(mockPrisma.kyc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'user-456',
          status:  'NOT_STARTED',
          level:   'L0',
        }),
      }),
    );
    expect(result).toEqual(baseKyc);
  });

  it('creates record with pi_user_id and username', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue(null);
    mockPrisma.kyc.create.mockResolvedValue(baseKyc);
    await service.getOrCreate('user-456', { piUserId: 'pi-789', username: 'testuser' });
    expect(mockPrisma.kyc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pi_user_id: 'pi-789', username: 'testuser' }),
      }),
    );
  });
});

// ══════════════════════════════════════════════════════════════
describe('KycService — startKyc', () => {

  it('throws when KYC already verified', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, status: 'VERIFIED', audit_logs: [] });
    await expect(service.startKyc('user-456')).rejects.toThrow(BadRequestException);
  });

  it('throws when KYC already pending', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, status: 'PENDING', audit_logs: [] });
    await expect(service.startKyc('user-456')).rejects.toThrow(BadRequestException);
  });

  it('starts KYC for NOT_STARTED status', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, audit_logs: [] });
    mockPrisma.kyc.update.mockResolvedValue({ ...baseKyc, status: 'NOT_STARTED' });
    mockPrisma.kycAuditLog.create.mockResolvedValue({});
    const result = await service.startKyc('user-456');
    expect(mockPrisma.kyc.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 'user-456' } }),
    );
    expect(result.status).toBe('NOT_STARTED');
  });

  it('creates audit log on start', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, audit_logs: [] });
    mockPrisma.kyc.update.mockResolvedValue(baseKyc);
    mockPrisma.kycAuditLog.create.mockResolvedValue({});
    await service.startKyc('user-456');
    expect(mockPrisma.kycAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'start' }),
      }),
    );
  });
});

// ══════════════════════════════════════════════════════════════
describe('KycService — uploadDocuments', () => {

  it('throws when KYC already verified', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, status: 'VERIFIED', audit_logs: [] });
    await expect(
      service.uploadDocuments('user-456', { idFrontUrl: 'url1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('uploads documents successfully', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, audit_logs: [] });
    mockPrisma.kyc.update.mockResolvedValue({ ...baseKyc, id_front_url: 'url1', selfie_url: 'url3' });
    mockPrisma.kycAuditLog.create.mockResolvedValue({});
    const result = await service.uploadDocuments('user-456', {
      idFrontUrl: 'url1',
      selfieUrl:  'url3',
    });
    expect(mockPrisma.kyc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id_front_url: 'url1',
          selfie_url:   'url3',
        }),
      }),
    );
    expect(result.id_front_url).toBe('url1');
  });

  it('creates audit log on upload', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, audit_logs: [] });
    mockPrisma.kyc.update.mockResolvedValue(baseKyc);
    mockPrisma.kycAuditLog.create.mockResolvedValue({});
    await service.uploadDocuments('user-456', { idFrontUrl: 'url1' });
    expect(mockPrisma.kycAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'upload_documents' }),
      }),
    );
  });
});

// ══════════════════════════════════════════════════════════════
describe('KycService — submitKyc', () => {

  it('throws when already verified', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, status: 'VERIFIED', audit_logs: [] });
    await expect(service.submitKyc('user-456')).rejects.toThrow(BadRequestException);
  });

  it('throws when already pending', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, status: 'PENDING', audit_logs: [] });
    await expect(service.submitKyc('user-456')).rejects.toThrow(BadRequestException);
  });

  it('throws when documents are missing', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({
      ...baseKyc, id_front_url: null, selfie_url: null, audit_logs: [],
    });
    await expect(service.submitKyc('user-456')).rejects.toThrow(BadRequestException);
  });

  it('throws when selfie is missing', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({
      ...baseKyc, id_front_url: 'url1', selfie_url: null, audit_logs: [],
    });
    await expect(service.submitKyc('user-456')).rejects.toThrow(BadRequestException);
  });

  it('submits KYC when documents are present', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({
      ...baseKyc, id_front_url: 'url1', selfie_url: 'url3', audit_logs: [],
    });
    mockPrisma.kyc.update.mockResolvedValue({ ...baseKyc, status: 'PENDING' });
    mockPrisma.kycAuditLog.create.mockResolvedValue({});
    const result = await service.submitKyc('user-456');
    expect(mockPrisma.kyc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
    expect(result.status).toBe('PENDING');
  });

  it('creates audit log on submit', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({
      ...baseKyc, id_front_url: 'url1', selfie_url: 'url3', audit_logs: [],
    });
    mockPrisma.kyc.update.mockResolvedValue({ ...baseKyc, status: 'PENDING' });
    mockPrisma.kycAuditLog.create.mockResolvedValue({});
    await service.submitKyc('user-456');
    expect(mockPrisma.kycAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'submit', to_status: 'PENDING' }),
      }),
    );
  });
});

// ══════════════════════════════════════════════════════════════
describe('KycService — verifyKyc', () => {

  it('throws when KYC record not found', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue(null);
    await expect(service.verifyKyc('user-000')).rejects.toThrow(NotFoundException);
  });

  it('verifies KYC with L1 level by default', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, status: 'PENDING' });
    mockPrisma.kyc.update.mockResolvedValue({ ...baseKyc, status: 'VERIFIED', level: 'L1' });
    mockPrisma.kycAuditLog.create.mockResolvedValue({});
    const result = await service.verifyKyc('user-456');
    expect(mockPrisma.kyc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'VERIFIED', level: 'L1' }),
      }),
    );
    expect(result.status).toBe('VERIFIED');
  });

  it('verifies KYC with L2 level', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, status: 'PENDING' });
    mockPrisma.kyc.update.mockResolvedValue({ ...baseKyc, status: 'VERIFIED', level: 'L2' });
    mockPrisma.kycAuditLog.create.mockResolvedValue({});
    await service.verifyKyc('user-456', 'L2');
    expect(mockPrisma.kyc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ level: 'L2' }),
      }),
    );
  });

  it('clears rejection_reason on verify', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, status: 'REJECTED' });
    mockPrisma.kyc.update.mockResolvedValue({ ...baseKyc, status: 'VERIFIED' });
    mockPrisma.kycAuditLog.create.mockResolvedValue({});
    await service.verifyKyc('user-456');
    expect(mockPrisma.kyc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rejection_reason: null }),
      }),
    );
  });
});

// ══════════════════════════════════════════════════════════════
describe('KycService — rejectKyc', () => {

  it('throws when KYC record not found', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue(null);
    await expect(service.rejectKyc('user-000', 'Fake docs')).rejects.toThrow(NotFoundException);
  });

  it('rejects KYC with reason', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, status: 'PENDING' });
    mockPrisma.kyc.update.mockResolvedValue({ ...baseKyc, status: 'REJECTED', rejection_reason: 'Fake docs' });
    mockPrisma.kycAuditLog.create.mockResolvedValue({});
    const result = await service.rejectKyc('user-456', 'Fake docs');
    expect(mockPrisma.kyc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED', rejection_reason: 'Fake docs' }),
      }),
    );
    expect(result.status).toBe('REJECTED');
  });

  it('creates audit log on reject', async () => {
    mockPrisma.kyc.findUnique.mockResolvedValue({ ...baseKyc, status: 'PENDING' });
    mockPrisma.kyc.update.mockResolvedValue({ ...baseKyc, status: 'REJECTED' });
    mockPrisma.kycAuditLog.create.mockResolvedValue({});
    await service.rejectKyc('user-456', 'Invalid document');
    expect(mockPrisma.kycAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'reject', to_status: 'REJECTED' }),
      }),
    );
  });
});
