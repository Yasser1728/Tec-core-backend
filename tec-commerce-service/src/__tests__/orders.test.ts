import { PrismaClient } from '../../prisma/client';
import { OrdersService } from '../modules/order/order.service';
import { ProductService } from '../modules/product/product.service';

// ─── Setup ────────────────────────────────────────────────────
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL } },
});

// ProductService يحتاج PrismaService — نعمل mock بسيط
const prismaServiceMock = Object.assign(prisma, {
  onModuleInit:    async () => {},
  onModuleDestroy: async () => {},
}) as any;

const productService = new ProductService(prismaServiceMock);
const ordersService  = new OrdersService();

// ─── Helpers ──────────────────────────────────────────────────
const TEST_SELLER = 'test-seller-001';
const TEST_BUYER  = 'test-buyer-001';

const cleanupTest = async () => {
  // حذف بالترتيب الصح بسبب Foreign Keys
  await prisma.orderTimeline.deleteMany({
    where: { order: { buyer_id: TEST_BUYER } },
  });
  await prisma.orderItem.deleteMany({
    where: { order: { buyer_id: TEST_BUYER } },
  });
  await prisma.order.deleteMany({ where: { buyer_id: TEST_BUYER } });
  await prisma.product.deleteMany({ where: { seller_id: TEST_SELLER } });
};

const createTestProduct = async (overrides: {
  title?: string;
  price?: number;
  stock?: number;
} = {}) => {
  return productService.create({
    sellerId:    TEST_SELLER,
    title:       overrides.title ?? 'Test Product',
    description: 'Product for testing',
    price:       overrides.price ?? 10,
    stock:       overrides.stock ?? 100,
    category:    'test',
  });
};

// ─────────────────────────────────────────────────────────────
describe('Commerce — Orders Tests', () => {

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanupTest();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanupTest();
  });

  // ═══════════════════════════════════════════════════════════
  // PRODUCT TESTS
  // ═══════════════════════════════════════════════════════════
  describe('ProductService', () => {

    it('should create a product', async () => {
      const product = await createTestProduct({ title: 'Pi Widget', price: 5, stock: 50 });

      expect(product.id).toBeDefined();
      expect(product.title).toBe('Pi Widget');
      expect(product.price).toBe(5);
      expect(product.stock).toBe(50);
      expect(product.status).toBe('ACTIVE');
      expect(product.seller_id).toBe(TEST_SELLER);
    });

    it('should list active products only', async () => {
      await createTestProduct({ title: 'Active Product' });

      // أنشئ product وبعدين عطِّله
      const inactive = await createTestProduct({ title: 'Inactive Product' });
      await prisma.product.update({
        where: { id: inactive.id },
        data:  { status: 'INACTIVE' },
      });

      const products = await productService.findAll({ sellerId: TEST_SELLER });

      expect(products.length).toBe(1);
      expect(products[0].title).toBe('Active Product');
    });

    it('should find product by id', async () => {
      const created = await createTestProduct({ title: 'Find Me' });
      const found   = await productService.findById(created.id);

      expect(found.id).toBe(created.id);
      expect(found.title).toBe('Find Me');
    });

    it('should throw NotFoundException for non-existent product', async () => {
      await expect(
        productService.findById('non-existent-id'),
      ).rejects.toThrow('Product not found');
    });

    it('should update product', async () => {
      const product = await createTestProduct({ price: 10 });
      const updated = await productService.update(product.id, TEST_SELLER, {
        price: 20,
        title: 'Updated Product',
      });

      expect(updated.price).toBe(20);
      expect(updated.title).toBe('Updated Product');
    });

    it('should soft-delete product (set INACTIVE)', async () => {
      const product = await createTestProduct();
      await productService.delete(product.id, TEST_SELLER);

      const found = await prisma.product.findUnique({ where: { id: product.id } });
      expect(found?.status).toBe('INACTIVE');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // ORDER TESTS
  // ═══════════════════════════════════════════════════════════
  describe('OrdersService — Create', () => {

    it('should create order with correct total', async () => {
      const p1 = await createTestProduct({ price: 10, stock: 10 });
      const p2 = await createTestProduct({ price: 20, stock: 10 });

      const order = await ordersService.createOrder({
        buyer_id: TEST_BUYER,
        items: [
          { product_id: p1.id, quantity: 2 },
          { product_id: p2.id, quantity: 1 },
        ],
      });

      expect(order.id).toBeDefined();
      expect(order.total).toBe(40); // (10×2) + (20×1)
      expect(order.status).toBe('PENDING');
      expect(order.items).toHaveLength(2);
    });

    it('should reserve stock on order creation', async () => {
      const product = await createTestProduct({ stock: 10 });

      await ordersService.createOrder({
        buyer_id: TEST_BUYER,
        items: [{ product_id: product.id, quantity: 3 }],
      });

      const updated = await prisma.product.findUnique({ where: { id: product.id } });
      expect(updated?.stock).toBe(7); // 10 - 3
    });

    it('should create order timeline entry', async () => {
      const product = await createTestProduct();

      const order = await ordersService.createOrder({
        buyer_id: TEST_BUYER,
        items: [{ product_id: product.id, quantity: 1 }],
      });

      expect(order.timeline).toHaveLength(1);
      expect(order.timeline[0].status).toBe('PENDING');
    });

    it('should reject order with insufficient stock', async () => {
      const product = await createTestProduct({ stock: 2 });

      await expect(
        ordersService.createOrder({
          buyer_id: TEST_BUYER,
          items: [{ product_id: product.id, quantity: 5 }],
        }),
      ).rejects.toThrow('Insufficient stock');
    });

    it('should reject empty order', async () => {
      await expect(
        ordersService.createOrder({ buyer_id: TEST_BUYER, items: [] }),
      ).rejects.toThrow('Order must have at least one item');
    });

    it('should snapshot product data on order creation', async () => {
      const product = await createTestProduct({ title: 'Snapshot Product' });

      const order = await ordersService.createOrder({
        buyer_id: TEST_BUYER,
        items: [{ product_id: product.id, quantity: 1 }],
      });

      const snapshot = order.items[0].snapshot as any;
      expect(snapshot.title).toBe('Snapshot Product');
      expect(snapshot.seller_id).toBe(TEST_SELLER);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // CHECKOUT TESTS
  // ═══════════════════════════════════════════════════════════
  describe('OrdersService — Checkout', () => {

    it('should mark order as PAID on checkout', async () => {
      const product = await createTestProduct();
      const order   = await ordersService.createOrder({
        buyer_id: TEST_BUYER,
        items: [{ product_id: product.id, quantity: 1 }],
      });

      const paid = await ordersService.checkout({
        order_id:   order.id,
        payment_id: `pay_${Date.now()}`,
      });

      expect(paid.status).toBe('PAID');
      expect(paid.payment_id).toBeDefined();
      expect(paid.paid_at).toBeInstanceOf(Date);
    });

    it('CRITICAL: should not checkout already paid order', async () => {
      const product    = await createTestProduct();
      const order      = await ordersService.createOrder({
        buyer_id: TEST_BUYER,
        items: [{ product_id: product.id, quantity: 1 }],
      });
      const payment_id = `pay_${Date.now()}`;

      await ordersService.checkout({ order_id: order.id, payment_id });

      await expect(
        ordersService.checkout({ order_id: order.id, payment_id: `pay_${Date.now()}_2` }),
      ).rejects.toThrow('Order is already paid');
    });

    it('CRITICAL: should not reuse same payment_id for two orders', async () => {
      const p1     = await createTestProduct({ title: 'P1' });
      const p2     = await createTestProduct({ title: 'P2' });
      const order1 = await ordersService.createOrder({
        buyer_id: TEST_BUYER,
        items: [{ product_id: p1.id, quantity: 1 }],
      });
      const order2 = await ordersService.createOrder({
        buyer_id: TEST_BUYER,
        items: [{ product_id: p2.id, quantity: 1 }],
      });

      const payment_id = `pay_unique_${Date.now()}`;
      await ordersService.checkout({ order_id: order1.id, payment_id });

      await expect(
        ordersService.checkout({ order_id: order2.id, payment_id }),
      ).rejects.toThrow('Payment already used');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // CANCEL TESTS
  // ═══════════════════════════════════════════════════════════
  describe('OrdersService — Cancel', () => {

    it('should cancel pending order and restore stock', async () => {
      const product = await createTestProduct({ stock: 10 });
      const order   = await ordersService.createOrder({
        buyer_id: TEST_BUYER,
        items: [{ product_id: product.id, quantity: 3 }],
      });

      // Stock انخفض لـ 7
      const afterOrder = await prisma.product.findUnique({ where: { id: product.id } });
      expect(afterOrder?.stock).toBe(7);

      await ordersService.cancelOrder(order.id, TEST_BUYER, 'Changed mind');

      // Stock رجع لـ 10
      const afterCancel = await prisma.product.findUnique({ where: { id: product.id } });
      expect(afterCancel?.stock).toBe(10);

      const cancelled = await prisma.order.findUnique({ where: { id: order.id } });
      expect(cancelled?.status).toBe('CANCELLED');
      expect(cancelled?.cancel_reason).toBe('Changed mind');
    });

    it('should not cancel paid order', async () => {
      const product = await createTestProduct();
      const order   = await ordersService.createOrder({
        buyer_id: TEST_BUYER,
        items: [{ product_id: product.id, quantity: 1 }],
      });

      await ordersService.checkout({
        order_id:   order.id,
        payment_id: `pay_${Date.now()}`,
      });

      await expect(
        ordersService.cancelOrder(order.id, TEST_BUYER),
      ).rejects.toThrow('Cannot cancel order with status: PAID');
    });

    it('should not cancel another user order', async () => {
      const product = await createTestProduct();
      const order   = await ordersService.createOrder({
        buyer_id: TEST_BUYER,
        items: [{ product_id: product.id, quantity: 1 }],
      });

      await expect(
        ordersService.cancelOrder(order.id, 'wrong-user'),
      ).rejects.toThrow('Order not found');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // LIST TESTS
  // ═══════════════════════════════════════════════════════════
  describe('OrdersService — List', () => {

    it('should list orders for buyer with pagination', async () => {
      const product = await createTestProduct();

      // أنشئ 3 orders
      for (let i = 0; i < 3; i++) {
        await ordersService.createOrder({
          buyer_id: TEST_BUYER,
          items: [{ product_id: product.id, quantity: 1 }],
        });
        // نرجع الـ stock عشان الـ order الجاي يشتغل
        await prisma.product.update({
          where: { id: product.id },
          data:  { stock: { increment: 1 } },
        });
      }

      const result = await ordersService.listOrders(TEST_BUYER, { page: 1, limit: 2 });

      expect(result.total).toBe(3);
      expect(result.orders).toHaveLength(2);
      expect(result.totalPages).toBe(2);
      expect(result.hasMore).toBe(true);
    });

    it('should filter orders by status', async () => {
      const product = await createTestProduct({ stock: 10 });

      const order1 = await ordersService.createOrder({
        buyer_id: TEST_BUYER,
        items: [{ product_id: product.id, quantity: 1 }],
      });
      await ordersService.createOrder({
        buyer_id: TEST_BUYER,
        items: [{ product_id: product.id, quantity: 1 }],
      });

      await ordersService.checkout({
        order_id:   order1.id,
        payment_id: `pay_${Date.now()}`,
      });

      const paid    = await ordersService.listOrders(TEST_BUYER, { status: 'PAID' });
      const pending = await ordersService.listOrders(TEST_BUYER, { status: 'PENDING' });

      expect(paid.total).toBe(1);
      expect(pending.total).toBe(1);
    });
  });
});
