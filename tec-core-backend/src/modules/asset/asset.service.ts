import { Injectable, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssetDto } from './dto/create-asset.dto';

@Injectable()
export class AssetService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Provisions a new asset and records initial ownership in a single transaction.
   * Ensures idempotency via transactionId and slug uniqueness.
   */
  async provisionAsset(data: CreateAssetDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Idempotency Check: Ensure transactionId hasn't been used
        const existingTx = await tx.asset.findUnique({
          where: { transactionId: data.transactionId },
        });
        if (existingTx) {
          throw new ConflictException('Asset provisioning already completed for this transaction');
        }

        // 2. Uniqueness Check: Ensure slug (e.g., domain name) is available
        const existingSlug = await tx.asset.findUnique({
          where: { slug: data.slug },
        });
        if (existingSlug) {
          throw new ConflictException('The requested asset slug is already registered');
        }

        // 3. Atomic Operation: Create Asset and initial Ownership History
        return await tx.asset.create({
          data: {
            transactionId: data.transactionId,
            ownerId: data.userId, // Map userId from DTO to ownerId in Schema
            category: data.category,
            slug: data.slug,
            metadata: data.metadata || {},
            // Automatically create the first entry in ownership history
            history: {
              create: {
                toOwnerId: data.userId,
                transactionId: data.transactionId,
              },
            },
          },
          include: {
            history: true, // Return history in the response for confirmation
          },
        });
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      
      // Log error here for production monitoring
      throw new InternalServerErrorException('Failed to provision asset due to a server error');
    }
  }

  /**
   * Finds a single asset by its unique slug
   */
  async findBySlug(slug: string) {
    return this.prisma.asset.findUnique({
      where: { slug },
      include: { history: true },
    });
  }

  /**
   * Retrieves all assets owned by a specific user
   */
  async findByUser(userId: string) {
    return this.prisma.asset.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
