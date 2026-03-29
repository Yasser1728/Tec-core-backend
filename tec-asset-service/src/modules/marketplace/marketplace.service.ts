import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateListingDto {
  assetId:      string;
  sellerId:     string;
  price:        number;
  title?:       string;
  description?: string;
  expiresAt?:   Date;
}

export interface BuyListingDto {
  listingId: string;
  buyerId:   string;
  paymentId: string;
}

@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  // ── List active listings ─────────────────────────────────────
  async getListings(filters?: {
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    limit?:    number;
    offset?:   number;
  }) {
    const where: any = { status: 'ACTIVE' };
    if (filters?.minPrice !== undefined) where.price = { gte: filters.minPrice };
    if (filters?.maxPrice !== undefined) where.price = { ...where.price, lte: filters.maxPrice };

    const [listings, total] = await Promise.all([
      this.prisma.assetListing.findMany({
        where,
        include: {
          asset: { select: { slug: true, category: true, metadata: true, ownerId: true } },
        },
        orderBy: { createdAt: 'desc' },
        take:    filters?.limit  ?? 20,
        skip:    filters?.offset ?? 0,
      }),
      this.prisma.assetListing.count({ where }),
    ]);

    return { listings, total };
  }

  // ── Get single listing ───────────────────────────────────────
  async getListing(id: string) {
    const listing = await this.prisma.assetListing.findUnique({
      where:   { id },
      include: { asset: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }

  // ── Create listing ───────────────────────────────────────────
  async createListing(dto: CreateListingDto) {
    if (dto.price <= 0) throw new BadRequestException('Price must be greater than 0');

    const asset = await this.prisma.asset.findUnique({
      where: { id: dto.assetId },
    });
    if (!asset)                        throw new NotFoundException('Asset not found');
    if (asset.ownerId !== dto.sellerId) throw new ForbiddenException('Not your asset');
    if (asset.status === 'ON_SALE')    throw new ConflictException('Asset already listed');
    if (asset.status === 'LOCKED')     throw new BadRequestException('Asset is locked');

    return this.prisma.$transaction(async (tx: any) => {
      await tx.asset.update({
        where: { id: dto.assetId },
        data:  { status: 'ON_SALE' },
      });

      return tx.assetListing.create({
        data: {
          assetId:     dto.assetId,
          sellerId:    dto.sellerId,
          price:       dto.price,
          title:       dto.title,
          description: dto.description,
          expiresAt:   dto.expiresAt,
        },
        include: { asset: true },
      });
    });
  }

  // ── Cancel listing ───────────────────────────────────────────
  async cancelListing(listingId: string, sellerId: string) {
    const listing = await this.prisma.assetListing.findUnique({
      where: { id: listingId },
    });
    if (!listing)                        throw new NotFoundException('Listing not found');
    if (listing.sellerId !== sellerId)   throw new ForbiddenException('Not your listing');
    if (listing.status !== 'ACTIVE')     throw new BadRequestException('Listing is not active');

    return this.prisma.$transaction(async (tx: any) => {
      await tx.asset.update({
        where: { id: listing.assetId },
        data:  { status: 'ACTIVE' },
      });

      return tx.assetListing.update({
        where: { id: listingId },
        data:  { status: 'CANCELLED' },
      });
    });
  }

  // ── Buy listing ──────────────────────────────────────────────
  async buyListing(dto: BuyListingDto) {
    const listing = await this.prisma.assetListing.findUnique({
      where:   { id: dto.listingId },
      include: { asset: true },
    });

    if (!listing)                      throw new NotFoundException('Listing not found');
    if (listing.status !== 'ACTIVE')   throw new BadRequestException('Listing is not active');
    if (listing.sellerId === dto.buyerId) throw new BadRequestException('Cannot buy your own listing');

    // Check payment not already used
    const existingPayment = await this.prisma.assetListing.findUnique({
      where: { paymentId: dto.paymentId },
    });
    if (existingPayment) throw new ConflictException('Payment already used');

    return this.prisma.$transaction(async (tx: any) => {
      // Transfer ownership
      await tx.asset.update({
        where: { id: listing.assetId },
        data: {
          ownerId: dto.buyerId,
          status:  'ACTIVE',
        },
      });

      // Record history
      await tx.assetHistory.create({
        data: {
          assetId:       listing.assetId,
          toOwnerId:     dto.buyerId,
          transactionId: dto.paymentId,
        },
      });

      // Mark listing as sold
      return tx.assetListing.update({
        where: { id: dto.listingId },
        data: {
          status:    'SOLD',
          buyerId:   dto.buyerId,
          paymentId: dto.paymentId,
          soldAt:    new Date(),
        },
        include: { asset: true },
      });
    });
  }

  // ── Get user listings ────────────────────────────────────────
  async getUserListings(userId: string) {
    return this.prisma.assetListing.findMany({
      where:   { sellerId: userId },
      include: { asset: { select: { slug: true, category: true, metadata: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Get user purchases ───────────────────────────────────────
  async getUserPurchases(userId: string) {
    return this.prisma.assetListing.findMany({
      where:   { buyerId: userId, status: 'SOLD' },
      include: { asset: { select: { slug: true, category: true, metadata: true } } },
      orderBy: { soldAt: 'desc' },
    });
  }
}
