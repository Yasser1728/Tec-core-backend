import { Test, TestingModule }    from '@nestjs/testing';
import { UnauthorizedException }  from '@nestjs/common';
import { JwtService }             from '@nestjs/jwt';
import { KycController }          from '../modules/kyc/kyc.controller';
import { KycService }             from '../modules/kyc/kyc.service';

const mockKyc = {
  id:      'kyc-uuid-1',
  user_id: 'user-uuid-1',
  status:  'NOT_STARTED',
  level:   'L0',
};

const kycServiceMock = {
  getOrCreate:     jest.fn(),
  startKyc:        jest.fn(),
  uploadDocuments: jest.fn(),
  submitKyc:       jest.fn(),
  verifyKyc:       jest.fn(),
  rejectKyc:       jest.fn(),
};

const jwtServiceMock = {
  decode: jest.fn(),
};

// ── Valid JWT token (base64 encoded payload) ──────────────────
const makeToken = (payload: object): string => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `header.${encoded}.signature`;
};

describe('KycController', () => {
  let controller: KycController;

  const validToken = makeToken({
    sub:         'user-uuid-1',
    pi_uid:      'pi-uuid-1',
    pi_username: 'testuser',
  });
  const validAuth = `Bearer ${validToken}`;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KycController],
      providers: [
        { provide: KycService,  useValue: kycServiceMock  },
        { provide: JwtService,  useValue: jwtServiceMock  },
      ],
    }).compile();

    controller = module.get<KycController>(KycController);
    jest.clearAllMocks();

    jwtServiceMock.decode.mockReturnValue({
      sub:         'user-uuid-1',
      pi_uid:      'pi-uuid-1',
      pi_username: 'testuser',
    });
  });

  // ── getStatus ────────────────────────────────────────────────
  describe('getStatus', () => {
    it('returns KYC status', async () => {
      kycServiceMock.getOrCreate.mockResolvedValue(mockKyc);

      const result = await controller.getStatus(validAuth);

      expect(result.success).toBe(true);
      expect(result.data.kyc).toEqual(mockKyc);
    });

    it('throws UnauthorizedException without token', async () => {
      await expect(controller.getStatus(''))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  // ── startKyc ────────────────────────────────────────────────
  describe('startKyc', () => {
    it('starts KYC process', async () => {
      kycServiceMock.startKyc.mockResolvedValue(mockKyc);

      const result = await controller.startKyc(validAuth);

      expect(result.success).toBe(true);
      expect(kycServiceMock.startKyc).toHaveBeenCalledWith('user-uuid-1');
    });
  });

  // ── uploadDocuments ──────────────────────────────────────────
  describe('uploadDocuments', () => {
    it('uploads documents', async () => {
      kycServiceMock.uploadDocuments.mockResolvedValue(mockKyc);

      const result = await controller.uploadDocuments(validAuth, {
        idFrontUrl: 'https://storage/front.jpg',
      });

      expect(result.success).toBe(true);
      expect(kycServiceMock.uploadDocuments).toHaveBeenCalledWith(
        'user-uuid-1',
        { idFrontUrl: 'https://storage/front.jpg' },
      );
    });
  });

  // ── submitKyc ────────────────────────────────────────────────
  describe('submitKyc', () => {
    it('submits KYC', async () => {
      kycServiceMock.submitKyc.mockResolvedValue({ ...mockKyc, status: 'PENDING' });

      const result = await controller.submitKyc(validAuth);

      expect(result.success).toBe(true);
      expect(kycServiceMock.submitKyc).toHaveBeenCalledWith('user-uuid-1');
    });
  });

  // ── verifyKyc ────────────────────────────────────────────────
  describe('verifyKyc', () => {
    it('verifies KYC', async () => {
      kycServiceMock.verifyKyc.mockResolvedValue({ ...mockKyc, status: 'VERIFIED' });

      const result = await controller.verifyKyc('user-uuid-1', { level: 'L1' });

      expect(result.success).toBe(true);
      expect(kycServiceMock.verifyKyc).toHaveBeenCalledWith('user-uuid-1', 'L1');
    });
  });

  // ── rejectKyc ────────────────────────────────────────────────
  describe('rejectKyc', () => {
    it('rejects KYC', async () => {
      kycServiceMock.rejectKyc.mockResolvedValue({ ...mockKyc, status: 'REJECTED' });

      const result = await controller.rejectKyc('user-uuid-1', { reason: 'unclear' });

      expect(result.success).toBe(true);
      expect(kycServiceMock.rejectKyc).toHaveBeenCalledWith('user-uuid-1', 'unclear');
    });
  });
});
