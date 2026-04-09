import { Test, TestingModule }  from '@nestjs/testing';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { AssetService }         from './asset.service';
import { PrismaService }        from '../prisma/prisma.service';

const mockAsset = {
  id:            'asset-uuid-1',
  transactionId: 'tx-uuid-1',
  ownerId:       'user-uuid-1',
  category:      'DIGITAL_ASSET',
  slug:          'my-asset-slug',
  metadata:      {},
  createdAt:     new Date(),
  updatedAt:     new Date(),
  history:       [],
};

const createDto = {
  transactionId: 'tx-uuid-1',
  userId:        'user-uuid-1',
  category:      'DIGITAL_ASSET' as any,
  slug:          'my-asset-slug',
  metadata:      {},
};

const txMock = {
  asset: {
    findUnique: jest.fn(),
    create:     jest.fn(),
  },
};

const prismaMock = {
  asset: {
    findUnique: jest.fn(),
    findMany:   jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('AssetService', () => {
  let service: AssetService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<AssetService>(AssetService);
    jest.clearAllMocks();
  });

  describe('provisionAsset', () => {
    it('creates asset successfully', async () => {
      prismaMock.$transaction.mockImplementation(async (fn: Function) => {
        txMock.asset.findUnique.mockResolvedValueOnce(null);
        txMock.asset.findUnique.mockResolvedValueOnce(null);
        txMock.asset.create.mockResolvedValue(mockAsset);
        return fn(txMock);
      });

      const result = await service.provisionAsset(createDto);
      expect(result).toEqual(mockAsset);
    });

    it('throws ConflictException if transaction already exists', async () => {
      prismaMock.$transaction.mockImplementation(async (fn: Function) => {
        txMock.asset.findUnique.mockResolvedValueOnce(mockAsset);
        return fn(txMock);
      });

      await expect(service.provisionAsset(createDto)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException if slug already exists', async () => {
      prismaMock.$transaction.mockImplementation(async (fn: Function) => {
        txMock.asset.findUnique.mockResolvedValueOnce(null);
        txMock.asset.findUnique.mockResolvedValueOnce(mockAsset);
        return fn(txMock);
      });

      await expect(service.provisionAsset(createDto)).rejects.toThrow(ConflictException);
    });

    it('throws InternalServerErrorException on unexpected error', async () => {
      prismaMock.$transaction.mockRejectedValue(new Error('DB connection failed'));

      await expect(service.provisionAsset(createDto)).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('findBySlug', () => {
    it('returns asset by slug', async () => {
      prismaMock.asset.findUnique.mockResolvedValue(mockAsset);

      const result = await service.findBySlug('my-asset-slug');

      expect(prismaMock.asset.findUnique).toHaveBeenCalledWith({
        where:   { slug: 'my-asset-slug' },
        include: { history: true },
      });
      expect(result).toEqual(mockAsset);
    });

    it('returns null when slug not found', async () => {
      prismaMock.asset.findUnique.mockResolvedValue(null);
      const result = await service.findBySlug('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('findByUser', () => {
    it('returns assets for user', async () => {
      prismaMock.asset.findMany.mockResolvedValue([mockAsset]);

      const result = await service.findByUser('user-uuid-1');

      expect(prismaMock.asset.findMany).toHaveBeenCalledWith({
        where:   { ownerId: 'user-uuid-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(1);
    });

    it('returns empty array when user has no assets', async () => {
      prismaMock.asset.findMany.mockResolvedValue([]);
      const result = await service.findByUser('user-uuid-1');
      expect(result).toHaveLength(0);
    });
  });

  describe('findAll', () => {
    it('returns all assets', async () => {
      prismaMock.asset.findMany.mockResolvedValue([mockAsset]);

      const result = await service.findAll();

      expect(prismaMock.asset.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(1);
    });
  });
});
