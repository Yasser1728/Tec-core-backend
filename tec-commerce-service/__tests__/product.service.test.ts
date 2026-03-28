import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProductService } from '../src/modules/product/product.service';
import { PrismaService } from '../src/prisma/prisma.service';

const mockPrisma = {
  product: {
    create:     jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    findFirst:  jest.fn(),
    update:     jest.fn(),
  },
};

const baseProduct = {
  id:          'prod-001',
  seller_id:   'seller-001',
  title:       'Test Product',
  description: 'A test product',
  price:       10,
  currency:    'PI',
  image_url:   null,
  stock:       100,
  status:      'ACTIVE',
  category:    'test',
  created_at:  new Date(),
  updated_at:  new Date(),
};

let service: ProductService;

beforeEach(async () => {
  jest.clearAllMocks();
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProductService,
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();
  service = module.get<ProductService>(ProductService);
});

describe('ProductService — create', () => {

  it('creates product successfully', async () => {
    mockPrisma.product.create.mockResolvedValue(baseProduct);
    const result = await service.create({
      sellerId: 'seller-001',
      title:    'Test Product',
      price:    10,
      stock:    100,
    });
    expect(result.title).toBe('Test Product');
    expect(result.status).toBe('ACTIVE');
    expect(mockPrisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ seller_id: 'seller-001', status: 'ACTIVE' }),
      }),
    );
  });

  it('creates product with all fields', async () => {
    mockPrisma.product.create.mockResolvedValue({ ...baseProduct, category: 'electronics' });
    await service.create({
      sellerId:    'seller-001',
      title:       'Widget',
      description: 'A widget',
      price:       25,
      stock:       50,
      category:    'electronics',
    });
    expect(mockPrisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: 'electronics' }),
      }),
    );
  });
});

describe('ProductService — findAll', () => {

  it('returns active products only', async () => {
    mockPrisma.product.findMany.mockResolvedValue([baseProduct]);
    const result = await service.findAll();
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
    expect(result).toHaveLength(1);
  });

  it('filters by category', async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    await service.findAll({ category: 'electronics' });
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: 'electronics' }),
      }),
    );
  });

  it('applies pagination', async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    await service.findAll({ limit: 5, offset: 10 });
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, skip: 10 }),
    );
  });
});

describe('ProductService — findById', () => {

  it('returns product by id', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(baseProduct);
    const result = await service.findById('prod-001');
    expect(result.id).toBe('prod-001');
  });

  it('throws NotFoundException when not found', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);
    await expect(service.findById('bad-id')).rejects.toThrow('Product not found');
  });
});

describe('ProductService — update', () => {

  it('updates product successfully', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(baseProduct);
    mockPrisma.product.update.mockResolvedValue({ ...baseProduct, price: 20 });
    const result = await service.update('prod-001', 'seller-001', { price: 20 });
    expect(result.price).toBe(20);
  });

  it('throws when product not found or wrong seller', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(null);
    await expect(
      service.update('prod-001', 'wrong-seller', { price: 20 }),
    ).rejects.toThrow('Product not found');
  });
});

describe('ProductService — delete', () => {

  it('soft-deletes product (sets INACTIVE)', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(baseProduct);
    mockPrisma.product.update.mockResolvedValue({ ...baseProduct, status: 'INACTIVE' });
    await service.delete('prod-001', 'seller-001');
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'INACTIVE' },
      }),
    );
  });

  it('throws when product not found', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(null);
    await expect(service.delete('bad-id', 'seller-001')).rejects.toThrow('Product not found');
  });
});
