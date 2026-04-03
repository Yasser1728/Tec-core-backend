import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException }   from '@nestjs/common';
import { ProductService }      from '../modules/product/product.service';
import { PrismaService }       from '../prisma/prisma.service';

// ── Mock Data ─────────────────────────────────────────────────
const mockProduct = {
  id:          'prod-uuid-1',
  seller_id:   'seller-uuid-1',
  title:       'Test Product',
  description: 'A test product',
  price:       10.5,
  image_url:   null,
  stock:       100,
  category:    'electronics',
  status:      'ACTIVE',
  created_at:  new Date(),
  updated_at:  new Date(),
};

const prismaMock = {
  product: {
    create:     jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    findFirst:  jest.fn(),
    update:     jest.fn(),
  },
};

// ── Tests ─────────────────────────────────────────────────────
describe('ProductService', () => {
  let service: ProductService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
    jest.clearAllMocks();
  });

  // ── create ───────────────────────────────────────────────────
  describe('create', () => {
    it('creates a product successfully', async () => {
      prismaMock.product.create.mockResolvedValue(mockProduct);

      const result = await service.create({
        sellerId:    'seller-uuid-1',
        title:       'Test Product',
        description: 'A test product',
        price:       10.5,
        stock:       100,
        category:    'electronics',
      });

      expect(prismaMock.product.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          seller_id: 'seller-uuid-1',
          title:     'Test Product',
          price:     10.5,
          stock:     100,
          status:    'ACTIVE',
        }),
      });
      expect(result).toEqual(mockProduct);
    });
  });

  // ── findAll ──────────────────────────────────────────────────
  describe('findAll', () => {
    it('returns all active products', async () => {
      prismaMock.product.findMany.mockResolvedValue([mockProduct]);

      const result = await service.findAll();

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where:   { status: 'ACTIVE' },
          take:    20,
          skip:    0,
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('filters by category', async () => {
      prismaMock.product.findMany.mockResolvedValue([mockProduct]);

      await service.findAll({ category: 'electronics' });

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACTIVE', category: 'electronics' },
        }),
      );
    });

    it('filters by sellerId', async () => {
      prismaMock.product.findMany.mockResolvedValue([mockProduct]);

      await service.findAll({ sellerId: 'seller-uuid-1' });

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACTIVE', seller_id: 'seller-uuid-1' },
        }),
      );
    });

    it('respects limit and offset', async () => {
      prismaMock.product.findMany.mockResolvedValue([]);

      await service.findAll({ limit: 5, offset: 10 });

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, skip: 10 }),
      );
    });
  });

  // ── findById ─────────────────────────────────────────────────
  describe('findById', () => {
    it('returns product by ID', async () => {
      prismaMock.product.findUnique.mockResolvedValue(mockProduct);

      const result = await service.findById('prod-uuid-1');

      expect(result).toEqual(mockProduct);
    });

    it('throws NotFoundException when not found', async () => {
      prismaMock.product.findUnique.mockResolvedValue(null);

      await expect(service.findById('non-existent'))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── update ───────────────────────────────────────────────────
  describe('update', () => {
    it('updates product successfully', async () => {
      prismaMock.product.findFirst.mockResolvedValue(mockProduct);
      prismaMock.product.update.mockResolvedValue({
        ...mockProduct,
        title: 'Updated Title',
      });

      const result = await service.update('prod-uuid-1', 'seller-uuid-1', {
        title: 'Updated Title',
      });

      expect(result.title).toBe('Updated Title');
    });

    it('throws NotFoundException when product not found or wrong seller', async () => {
      prismaMock.product.findFirst.mockResolvedValue(null);

      await expect(
        service.update('prod-uuid-1', 'wrong-seller', { title: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── delete ───────────────────────────────────────────────────
  describe('delete', () => {
    it('soft-deletes product by setting status to INACTIVE', async () => {
      prismaMock.product.findFirst.mockResolvedValue(mockProduct);
      prismaMock.product.update.mockResolvedValue({
        ...mockProduct,
        status: 'INACTIVE',
      });

      const result = await service.delete('prod-uuid-1', 'seller-uuid-1');

      expect(prismaMock.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-uuid-1' },
        data:  { status: 'INACTIVE' },
      });
      expect(result.status).toBe('INACTIVE');
    });

    it('throws NotFoundException when product not found', async () => {
      prismaMock.product.findFirst.mockResolvedValue(null);

      await expect(
        service.delete('prod-uuid-1', 'wrong-seller'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
