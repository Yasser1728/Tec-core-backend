import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { AssetService } from '../src/modules/asset/asset.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const mockPrisma = {
  asset: {
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    create:     jest.fn(),
  },
  $transaction: jest.fn(),
};

const baseAsset = {
  id:            'asset-001',
  transactionId: 'tx-uuid-001',
  ownerId:       'user-001',
  slug:          'test-domain.pi',
  category:      'DOMAIN',
  status:        'ACTIVE',
  metadata:      { extension: '.pi' },
  createdAt:     new Date(),
  updatedAt:     new Date(),
  history:       [{ id: 'hist-001', assetId: 'asset-001', toOwnerId: 'user-001', transactionId: 'tx-uuid-001', createdAt: new Date() }],
};

const baseDto = {
  transactionId: 'tx-uuid-001',
  userId:        'user-001',
  slug:          'test-domain.pi',
  category:      'DOMAIN' as const,
  metadata:      { extension: '.pi' },
};

let service: AssetService;

beforeEach(async () => {
  jest.clearAllMocks();
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AssetService,
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();
  service = module.get<AssetService>(AssetService);
});

// ══════════════════════════════════════════════════════════
describe('AssetService — provisionAsset', () => {

  it('provisions asset successfully', async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn({
      asset: {
        findUnique: jest.fn().mockResolvedValue(null),
        create:     jest.fn().mockResolvedValue(baseAsset),
      },
    }));

    const result = await service.provisionAsset(baseDto);
    expect(result.id).toBe('asset-001');
    expect(result.slug).toBe('test-domain.pi');
    expect(result.status).toBe('ACTIVE');
  });

  it('throws ConflictException when transactionId already used', async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn({
      asset: {
        findUnique: jest.fn().mockResolvedValue(baseAsset),
        create:     jest.fn(),
      },
    }));

    await expect(service.provisionAsset(baseDto)).rejects.toThrow(ConflictException);
    await expect(service.provisionAsset(baseDto)).rejects.toThrow(
      'Asset provisioning already completed for this transaction',
    );
  });

  it('throws ConflictException when slug already registered', async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn({
      asset: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)        // transactionId not found
          .mockResolvedValueOnce(baseAsset),  // slug already exists
        create: jest.fn(),
      },
    }));

    await expect(service.provisionAsset(baseDto)).rejects.toThrow(ConflictException);
    await expect(service.provisionAsset(baseDto)).rejects.toThrow(
      'The requested asset slug is already registered',
    );
  });

  it('creates asset with correct ownerId mapped from userId', async () => {
    const mockCreate = jest.fn().mockResolvedValue(baseAsset);
    mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn({
      asset: {
        findUnique: jest.fn().mockResolvedValue(null),
        create:     mockCreate,
      },
    }));

    await service.provisionAsset(baseDto);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId:       'user-001',
          transactionId: 'tx-uuid-001',
          slug:          'test-domain.pi',
          category:      'DOMAIN',
        }),
      }),
    );
  });

  it('creates ownership history on provision', async () => {
    const mockCreate = jest.fn().mockResolvedValue(baseAsset);
    mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn({
      asset: {
        findUnique: jest.fn().mockResolvedValue(null),
        create:     mockCreate,
      },
    }));

    await service.provisionAsset(baseDto);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          history: {
            create: expect.objectContaining({
              toOwnerId:     'user-001',
              transactionId: 'tx-uuid-001',
            }),
          },
        }),
      }),
    );
  });

  it('uses empty object when metadata not provided', async () => {
    const mockCreate = jest.fn().mockResolvedValue(baseAsset);
    mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn({
      asset: {
        findUnique: jest.fn().mockResolvedValue(null),
        create:     mockCreate,
      },
    }));

    await service.provisionAsset({ ...baseDto, metadata: undefined });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: {} }),
      }),
    );
  });

  it('throws InternalServerErrorException on unexpected DB error', async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn({
      asset: {
        findUnique: jest.fn().mockRejectedValue(new Error('Connection refused')),
        create:     jest.fn(),
      },
    }));

    await expect(service.provisionAsset(baseDto)).rejects.toThrow(InternalServerErrorException);
  });

  it('includes history in response', async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn({
      asset: {
        findUnique: jest.fn().mockResolvedValue(null),
        create:     jest.fn().mockResolvedValue(baseAsset),
      },
    }));

    const result = await service.provisionAsset(baseDto);
    expect(result.history).toHaveLength(1);
    expect(result.history[0].toOwnerId).toBe('user-001');
  });
});

// ══════════════════════════════════════════════════════════
describe('AssetService — findBySlug', () => {

  it('returns asset when found', async () => {
    mockPrisma.asset.findUnique.mockResolvedValue(baseAsset);
    const result = await service.findBySlug('test-domain.pi');
    expect(result?.slug).toBe('test-domain.pi');
    expect(mockPrisma.asset.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'test-domain.pi' } }),
    );
  });

  it('returns null when not found', async () => {
    mockPrisma.asset.findUnique.mockResolvedValue(null);
    const result = await service.findBySlug('nonexistent.pi');
    expect(result).toBeNull();
  });

  it('includes history in response', async () => {
    mockPrisma.asset.findUnique.mockResolvedValue(baseAsset);
    const result = await service.findBySlug('test-domain.pi');
    expect(result?.history).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════
describe('AssetService — findByUser', () => {

  it('returns assets for user ordered by createdAt desc', async () => {
    mockPrisma.asset.findMany.mockResolvedValue([baseAsset]);
    const result = await service.findByUser('user-001');
    expect(result).toHaveLength(1);
    expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where:   { ownerId: 'user-001' },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('returns empty array when user has no assets', async () => {
    mockPrisma.asset.findMany.mockResolvedValue([]);
    const result = await service.findByUser('user-000');
    expect(result).toEqual([]);
  });

  it('returns multiple assets', async () => {
    mockPrisma.asset.findMany.mockResolvedValue([
      { ...baseAsset, id: 'asset-001', slug: 'domain1.pi' },
      { ...baseAsset, id: 'asset-002', slug: 'domain2.pi' },
    ]);
    const result = await service.findByUser('user-001');
    expect(result).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════════════════
describe('AssetService — findAll', () => {

  it('returns all assets ordered by createdAt desc', async () => {
    mockPrisma.asset.findMany.mockResolvedValue([baseAsset]);
    const result = await service.findAll();
    expect(result).toHaveLength(1);
    expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('returns empty array when no assets', async () => {
    mockPrisma.asset.findMany.mockResolvedValue([]);
    const result = await service.findAll();
    expect(result).toEqual([]);
  });
});
