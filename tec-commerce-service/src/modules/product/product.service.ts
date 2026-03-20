import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    sellerId: string;
    title: string;
    description?: string;
    price: number;
    imageUrl?: string;
    stock: number;
    category?: string;
  }) {
    return this.prisma.product.create({
      data: {
        seller_id: data.sellerId,
        title: data.title,
        description: data.description,
        price: data.price,
        image_url: data.imageUrl,
        stock: data.stock,
        category: data.category,
        status: 'ACTIVE',
      },
    });
  }

  async findAll(filters?: {
    category?: string;
    sellerId?: string;
    limit?: number;
    offset?: number;
  }) {
    return this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        ...(filters?.category ? { category: filters.category } : {}),
        ...(filters?.sellerId ? { seller_id: filters.sellerId } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: filters?.limit ?? 20,
      skip: filters?.offset ?? 0,
    });
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(id: string, sellerId: string, data: {
    title?: string;
    description?: string;
    price?: number;
    imageUrl?: string;
    stock?: number;
    status?: 'ACTIVE' | 'INACTIVE' | 'SOLD_OUT';
  }) {
    const product = await this.prisma.product.findFirst({
      where: { id, seller_id: sellerId },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.description && { description: data.description }),
        ...(data.price && { price: data.price }),
        ...(data.imageUrl && { image_url: data.imageUrl }),
        ...(data.stock !== undefined && { stock: data.stock }),
        ...(data.status && { status: data.status }),
      },
    });
  }

  async delete(id: string, sellerId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, seller_id: sellerId },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.prisma.product.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });
  }
}
