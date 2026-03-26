import { Injectable, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssetDto } from './dto/create-asset.dto';

@Injectable()
export class AssetService {
  constructor(private readonly prisma: PrismaService) {}

  async provisionAsset(data: CreateAssetDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingTx = await tx.asset.findUnique({
          where: { transactionId: data.transactionId },
        });
        if (existingTx) {
          throw new ConflictException('Asset provisioning already completed for this transaction');
        }

        const existingSlug = await tx.asset.findUnique({
          where: { slug: data.slug },
        });
        if (existingSlug) {
          throw new ConflictException('The requested asset slug is already registered');
        }

        return await tx.asset.create({
          data: {
            transactionId: data.transactionId,
            ownerId:       data.userId,
            category:      data.category,
            slug:          data.slug,
            metadata:      data.metadata || {},
            history: {
              create: {
                toOwnerId:     data.userId,
                transactionId: data.transactionId,
              },
            },
          },
          include: { history: true },
        });
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new InternalServerErrorException('Failed to provision asset');
    }
  }

  async findBySlug(slug: string) {
    return this.prisma.asset.findUnique({
      where: { slug },
      include: { history: true },
    });
  }

  async findByUser(userId: string) {
    return this.prisma.asset.findMany({
      where:   { ownerId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ← أضفنا findAll عشان الـ tests
  async findAll() {
    return this.prisma.asset.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}
