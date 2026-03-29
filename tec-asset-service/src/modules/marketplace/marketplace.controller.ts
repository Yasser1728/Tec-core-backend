import {
  Controller, Get, Post, Patch,
  Body, Param, Query,
  HttpCode, HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';

@Controller('assets/marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  // GET /api/assets/marketplace
  @Get()
  async getListings(
    @Query('category') category?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('limit')    limit?: string,
    @Query('offset')   offset?: string,
  ) {
    const result = await this.marketplaceService.getListings({
      category,
      minPrice: minPrice ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
      limit:    limit    ? parseInt(limit)       : 20,
      offset:   offset   ? parseInt(offset)      : 0,
    });
    return { success: true, ...result };
  }

  // GET /api/assets/marketplace/:id
  @Get(':id')
  async getListing(@Param('id') id: string) {
    const listing = await this.marketplaceService.getListing(id);
    return { success: true, data: { listing } };
  }

  // POST /api/assets/marketplace/list
  @Post('list')
  @HttpCode(HttpStatus.CREATED)
  async createListing(@Body() body: {
    assetId:      string;
    sellerId:     string;
    price:        number;
    title?:       string;
    description?: string;
  }) {
    if (!body.assetId || !body.sellerId || !body.price) {
      throw new BadRequestException('assetId, sellerId, price required');
    }
    const listing = await this.marketplaceService.createListing(body);
    return { success: true, data: { listing } };
  }

  // PATCH /api/assets/marketplace/:id/cancel
  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelListing(
    @Param('id')        id: string,
    @Body('sellerId')   sellerId: string,
  ) {
    if (!sellerId) throw new BadRequestException('sellerId required');
    const result = await this.marketplaceService.cancelListing(id, sellerId);
    return { success: true, data: { listing: result } };
  }

  // POST /api/assets/marketplace/:id/buy
  @Post(':id/buy')
  @HttpCode(HttpStatus.OK)
  async buyListing(
    @Param('id')        id: string,
    @Body('buyerId')    buyerId: string,
    @Body('paymentId')  paymentId: string,
  ) {
    if (!buyerId || !paymentId) {
      throw new BadRequestException('buyerId and paymentId required');
    }
    const result = await this.marketplaceService.buyListing({
      listingId: id,
      buyerId,
      paymentId,
    });
    return { success: true, data: { listing: result } };
  }

  // GET /api/assets/marketplace/user/:userId/listings
  @Get('user/:userId/listings')
  async getUserListings(@Param('userId') userId: string) {
    const listings = await this.marketplaceService.getUserListings(userId);
    return { success: true, data: { listings } };
  }

  // GET /api/assets/marketplace/user/:userId/purchases
  @Get('user/:userId/purchases')
  async getUserPurchases(@Param('userId') userId: string) {
    const purchases = await this.marketplaceService.getUserPurchases(userId);
    return { success: true, data: { purchases } };
  }
}
