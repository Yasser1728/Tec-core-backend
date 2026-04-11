import { Test, TestingModule } from '@nestjs/testing';

// ── Mock PrismaService ────────────────────────────────────
const mockPrisma = {
  product: {
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    update:     jest.fn(),
  },
  order: {
    create:     jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    update:     jest.fn(),
    count:      jest.fn(),
  },
  orderTimeline: { create: jest.fn() },
  $transaction:  jest.fn(),
};

import { OrdersService }  from '../src/modules/order/order.service';
import { PrismaService }  from '../src/prisma/prisma.service';

const baseProduct = {
  id:        'prod-001',
  seller_id: 'seller-001',
  title:     'Test Product',
  price:     10,
  currency:  'PI',
  stock:     100,
  status:    'ACTIVE',
  image_url: null,
};

const baseOrder = {
  id:            'order-001',
  buyer_id:      'buyer-001',
  status:        'PENDING',
  total:         10,
  currency:      'PI',
  payment_id:    null,
  paid_at:       null,
  cancel_reason: null,
  created_at:    new Date(),
  updated_at:    new Date(),
  items: [{
    id:         'item-001',
    product_id: 'prod-001',
    quantity:   1,
    price:      10,
    currency:   'PI',
    snapshot:   { title: 'Test Product', seller_id: 'seller-001' },
  }],
  timeline: [{ id: 'tl-001', status: 'PENDING', note: 'Order created' }],
};

let service: OrdersService;

beforeEach(async () => {
  jest.clearAllMocks();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OrdersService,
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();

  service = module.get<OrdersService>(OrdersService);
});

// ══════════════════════════════════════════════════════════
describe('OrdersService — createOrder', () => {

  it('throws when items is empty', async () => {
    await expect(
      service.createOrder({ buyer_id: 'buyer-001', items: [] }),
    ).rejects.toThrow('Order must have at least one item');
  });

  it('throws when product not found', async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    await expect(
      service.createOrder({ buyer_id: 'buyer-001', items: [{ product_id: 'bad-id', quantity: 1 }] }),
    ).rejects.toThrow('One or more products not found or inactive');
  });

  it('throws when insufficient stock', async () => {
    mockPrisma.product.findMany.mockResolvedValue([{ ...baseProduct, stock: 2 }]);
    await expect(
      service.createOrder({ buyer_id: 'buyer-001', items: [{ product_id: 'prod-001', quantity: 5 }] }),
    ).rejects.toThrow('Insufficient stock');
  });

  it('creates order with correct total', async () => {
    mockPrisma.product.findMany.mockResolvedValue([baseProduct]);
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn({
      ...mockPrisma,
      order:   { ...mockPrisma.order,   create: jest.fn().mockResolvedValue(baseOrder) },
      product: { ...mockPrisma.product, update: jest.fn() },
    }));

    const result = await service.createOrder({
      buyer_id: 'buyer-001',
      items:    [{ product_id: 'prod-001', quantity: 1 }],
    });

    expect(result.total).toBe(10);
    expect(result.status).toBe('PENDING');
  });

  it('calculates total for multiple items', async () => {
    const products = [
      { ...baseProduct, id: 'prod-001', price: 10 },
      { ...baseProduct, id: 'prod-002', price: 20 },
    ];
    mockPrisma.product.findMany.mockResolvedValue(products);
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn({
      ...mockPrisma,
      order:   { ...mockPrisma.order,   create: jest.fn().mockResolvedValue({ ...baseOrder, total: 40 }) },
      product: { ...mockPrisma.product, update: jest.fn() },
    }));

    const result = await service.createOrder({
      buyer_id: 'buyer-001',
      items: [
        { product_id: 'prod-001', quantity: 2 },
        { product_id: 'prod-002', quantity: 1 },
      ],
    });

    expect(result.total).toBe(40);
  });

  it('reserves stock on order creation', async () => {
    const mockProductUpdate = jest.fn();
    mockPrisma.product.findMany.mockResolvedValue([baseProduct]);
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn({
      ...mockPrisma,
      order:   { ...mockPrisma.order,   create: jest.fn().mockResolvedValue(baseOrder) },
      product: { ...mockPrisma.product, update: mockProductUpdate },
    }));

    await service.createOrder({
      buyer_id: 'buyer-001',
      items:    [{ product_id: 'prod-001', quantity: 3 }],
    });

    expect(mockProductUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stock: { decrement: 3 } } }),
    );
  });
});

// ══════════════════════════════════════════════════════════
describe('OrdersService — checkout', () => {

  it('throws when order not found', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);
    await expect(
      service.checkout({ order_id: 'bad-id', payment_id: 'pay-001' }),
    ).rejects.toThrow('Order not found');
  });

  it('throws when order already paid', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'PAID' });
    await expect(
      service.checkout({ order_id: 'order-001', payment_id: 'pay-001' }),
    ).rejects.toThrow('Order is already paid');
  });

  it('throws when payment_id already used', async () => {
    mockPrisma.order.findUnique
      .mockResolvedValueOnce({ ...baseOrder, status: 'PENDING' })
      .mockResolvedValueOnce({ ...baseOrder, id: 'other-order' });
    await expect(
      service.checkout({ order_id: 'order-001', payment_id: 'pay-used' }),
    ).rejects.toThrow('Payment already used');
  });

  it('marks order as PAID on successful checkout', async () => {
    const paidOrder = { ...baseOrder, status: 'PAID', payment_id: 'pay-001', paid_at: new Date() };
    mockPrisma.order.findUnique
      .mockResolvedValueOnce({ ...baseOrder, status: 'PENDING' })
      .mockResolvedValueOnce(null);

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn({
      ...mockPrisma,
      order:         { ...mockPrisma.order, update: jest.fn().mockResolvedValue(paidOrder) },
      orderTimeline: { create: jest.fn() },
    }));

    const result = await service.checkout({ order_id: 'order-001', payment_id: 'pay-001' });
    expect(result.status).toBe('PAID');
    expect(result.payment_id).toBe('pay-001');
  });
});

// ══════════════════════════════════════════════════════════
describe('OrdersService — cancelOrder', () => {

  it('throws when order not found', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);
    await expect(service.cancelOrder('bad-id', 'buyer-001')).rejects.toThrow('Order not found');
  });

  it('throws when buyer_id does not match', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({ ...baseOrder, buyer_id: 'other-buyer' });
    await expect(service.cancelOrder('order-001', 'buyer-001')).rejects.toThrow('Order not found');
  });

  it('throws when order is not cancellable', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'PAID', items: baseOrder.items });
    await expect(service.cancelOrder('order-001', 'buyer-001')).rejects.toThrow('Cannot cancel order with status: PAID');
  });

  it('cancels pending order and restores stock', async () => {
    const mockProductUpdate = jest.fn();
    mockPrisma.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'PENDING', items: baseOrder.items });
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn({
      ...mockPrisma,
      order:         { ...mockPrisma.order,   update: jest.fn() },
      orderTimeline: { create: jest.fn() },
      product:       { ...mockPrisma.product, update: mockProductUpdate },
    }));

    const result = await service.cancelOrder('order-001', 'buyer-001', 'Changed mind');
    expect(result.success).toBe(true);
    expect(mockProductUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stock: { increment: 1 } } }),
    );
  });
});

// ══════════════════════════════════════════════════════════
describe('OrdersService — listOrders', () => {

  it('returns paginated orders', async () => {
    mockPrisma.order.findMany.mockResolvedValue([baseOrder, baseOrder]);
    mockPrisma.order.count.mockResolvedValue(5);

    const result = await service.listOrders('buyer-001', { page: 1, limit: 2 });
    expect(result.orders).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.totalPages).toBe(3);
    expect(result.hasMore).toBe(true);
  });

  it('filters by status', async () => {
    mockPrisma.order.findMany.mockResolvedValue([{ ...baseOrder, status: 'PAID' }]);
    mockPrisma.order.count.mockResolvedValue(1);

    const result = await service.listOrders('buyer-001', { status: 'PAID' });
    expect(result.orders[0].status).toBe('PAID');
  });

  it('returns empty when no orders', async () => {
    mockPrisma.order.findMany.mockResolvedValue([]);
    mockPrisma.order.count.mockResolvedValue(0);

    const result = await service.listOrders('buyer-001');
    expect(result.orders).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
describe('OrdersService — getOrder', () => {

  it('returns order by id', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(baseOrder);
    const result = await service.getOrder('order-001');
    expect(result.id).toBe('order-001');
  });

  it('throws when order not found', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);
    await expect(service.getOrder('bad-id')).rejects.toThrow('Order not found');
  });

  it('throws when buyer_id does not match', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({ ...baseOrder, buyer_id: 'other' });
    await expect(service.getOrder('order-001', 'buyer-001')).rejects.toThrow('Order not found');
  });
});
