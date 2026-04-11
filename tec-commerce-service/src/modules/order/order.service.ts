import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  Product,
} from '../../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type PrismaTx = Prisma.TransactionClient;

export interface CreateOrderDto {
  buyer_id:       string;
  items:          { product_id: string; quantity: number }[];
  shipping_addr?: string;
  notes?:         string;
}

export interface CheckoutDto {
  order_id:       string;
  payment_id:     string;
  pi_payment_id?: string;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrder(dto: CreateOrderDto) {
    if (!dto.items?.length) {
      throw new BadRequestException('Order must have at least one item');
    }

    const productIds = dto.items.map(i => i.product_id);
    const products   = await this.prisma.product.findMany({
      where: { id: { in: productIds }, status: 'ACTIVE' },
    });

    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products not found or inactive');
    }

    for (const item of dto.items) {
      const product = products.find((p: Product) => p.id === item.product_id)!;
      if (product.stock < item.quantity) {
        throw new BadRequestException(`Insufficient stock for: ${product.title}`);
      }
    }

    const total    = dto.items.reduce((sum, item) => {
      const product = products.find((p: Product) => p.id === item.product_id)!;
      return sum + product.price * item.quantity;
    }, 0);
    const currency = products[0].currency;

    return this.prisma.$transaction(async (tx: PrismaTx) => {
      const newOrder = await tx.order.create({
        data: {
          buyer_id:      dto.buyer_id,
          total,
          currency,
          shipping_addr: dto.shipping_addr,
          notes:         dto.notes,
          items: {
            create: dto.items.map(item => {
              const product = products.find((p: Product) => p.id === item.product_id)!;
              return {
                product_id: item.product_id,
                quantity:   item.quantity,
                price:      product.price,
                currency:   product.currency,
                snapshot: {
                  title:     product.title,
                  image_url: product.image_url,
                  seller_id: product.seller_id,
                },
              };
            }),
          },
          timeline: {
            create: { status: 'PENDING', note: 'Order created' },
          },
        },
        include: { items: true, timeline: true },
      });

      for (const item of dto.items) {
        await tx.product.update({
          where: { id: item.product_id },
          data:  { stock: { decrement: item.quantity } },
        });
      }

      return newOrder;
    });
  }

  async checkout(dto: CheckoutDto) {
    const order = await this.prisma.order.findUnique({ where: { id: dto.order_id } });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status !== 'PENDING') {
      throw new ConflictException(`Order is already ${order.status.toLowerCase()}`);
    }

    if (dto.payment_id) {
      const existing = await this.prisma.order.findUnique({
        where: { payment_id: dto.payment_id },
      });
      if (existing && existing.id !== dto.order_id) {
        throw new ConflictException('Payment already used for another order');
      }
    }

    return this.prisma.$transaction(async (tx: PrismaTx) => {
      const updatedOrder = await tx.order.update({
        where: { id: dto.order_id },
        data: {
          status:        'PAID',
          payment_id:    dto.payment_id,
          pi_payment_id: dto.pi_payment_id,
          paid_at:       new Date(),
        },
        include: { items: true },
      });

      await tx.orderTimeline.create({
        data: {
          order_id:   dto.order_id,
          status:     'PAID',
          note:       `Payment confirmed: ${dto.payment_id}`,
          created_by: 'payment-service',
        },
      });

      return updatedOrder;
    });
  }

  async getOrder(id: string, buyer_id?: string) {
    const order = await this.prisma.order.findUnique({
      where:   { id },
      include: { items: true, timeline: { orderBy: { created_at: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (buyer_id && order.buyer_id !== buyer_id) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async listOrders(
    buyer_id: string,
    options: { page?: number; limit?: number; status?: string } = {},
  ) {
    const { page = 1, limit = 10, status } = options;
    const where: Prisma.OrderWhereInput = { buyer_id };
    if (status) where.status = status as OrderStatus;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { items: true },
        orderBy: { created_at: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      orders,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      hasMore:    page * limit < total,
    };
  }

  async cancelOrder(id: string, buyer_id: string, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where:   { id },
      include: { items: true },
    });

    if (!order)                      throw new NotFoundException('Order not found');
    if (order.buyer_id !== buyer_id) throw new NotFoundException('Order not found');

    const cancellable: OrderStatus[] = ['PENDING'];
    if (!cancellable.includes(order.status)) {
      throw new ConflictException(`Cannot cancel order with status: ${order.status}`);
    }

    await this.prisma.$transaction(async (tx: PrismaTx) => {
      await tx.order.update({
        where: { id },
        data: {
          status:        'CANCELLED',
          cancelled_at:  new Date(),
          cancel_reason: reason,
        },
      });

      await tx.orderTimeline.create({
        data: {
          order_id:   id,
          status:     'CANCELLED',
          note:       reason ?? 'Cancelled by user',
          created_by: buyer_id,
        },
      });

      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.product_id },
          data:  { stock: { increment: item.quantity } },
        });
      }
    });

    return { success: true, message: 'Order cancelled' };
  }
                                                      }
