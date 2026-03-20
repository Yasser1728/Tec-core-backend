import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrder(data: {
    buyerId: string;
    items: { productId: string; quantity: number }[];
  }) {
    // جيب الـ products
    const products = await Promise.all(
      data.items.map(item => this.prisma.product.findUnique({
        where: { id: item.productId },
      }))
    );

    // تحقق من الـ stock
    for (let i = 0; i < data.items.length; i++) {
      const product = products[i];
      const item = data.items[i];

      if (!product || product.status !== 'ACTIVE') {
        throw new BadRequestException(`Product ${item.productId} is not available`);
      }

      if (product.stock < item.quantity) {
        throw new BadRequestException(`Insufficient stock for ${product.title}`);
      }
    }

    // احسب الـ total
    const total = data.items.reduce((sum, item, i) => {
      return sum + (products[i]!.price * item.quantity);
    }, 0);

    // أنشئ الـ order في transaction
    const order = await this.prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          buyer_id: data.buyerId,
          total,
          status: 'PENDING',
          items: {
            create: data.items.map((item, i) => ({
              product_id: item.productId,
              quantity: item.quantity,
              price: products[i]!.price,
            })),
          },
        },
        include: { items: { include: { product: true } } },
      });

      // حدّث الـ stock
      for (const item of data.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      return newOrder;
    });

    console.log(`[OrderService] Order created: ${order.id} total: ${total} PI`);
    return order;
  }

  async getOrder(id: string, buyerId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, buyer_id: buyerId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async getUserOrders(buyerId: string) {
    return this.prisma.order.findMany({
      where: { buyer_id: buyerId },
      include: { items: { include: { product: true } } },
      orderBy: { created_at: 'desc' },
    });
  }

  async updateOrderStatus(
    id: string,
    status: 'PAID' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED',
    paymentId?: string,
  ) {
    return this.prisma.order.update({
      where: { id },
      data: {
        status,
        ...(paymentId ? { payment_id: paymentId } : {}),
      },
    });
  }
      }
