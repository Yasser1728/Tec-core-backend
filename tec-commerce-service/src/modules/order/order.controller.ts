import {
  Controller, Get, Post, Patch, Body, Param, Query,
  Headers, HttpCode, HttpStatus, BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OrdersService, CreateOrderDto, CheckoutDto } from './order.service';

@Controller('commerce/orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly jwtService: JwtService,
  ) {}

  // ← decode بدل verify — الـ Gateway بيعمل verify قبلنا
  private getUserId(authorization?: string): string {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = authorization.replace('Bearer ', '');
    try {
      const decoded = this.jwtService.decode(token) as any;
      if (!decoded) throw new Error('Invalid token');
      return decoded.sub ?? decoded.id;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrder(
    @Headers('authorization') auth: string,
    @Body() body: Omit<CreateOrderDto, 'buyer_id'> & { buyer_id?: string },
  ) {
    const buyer_id = body.buyer_id || this.getUserId(auth);
    const order = await this.ordersService.createOrder({ ...body, buyer_id });
    return { success: true, data: { order } };
  }

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  async checkout(
    @Headers('authorization') auth: string,
    @Body() dto: CheckoutDto,
  ) {
    if (!dto.order_id || !dto.payment_id) {
      throw new BadRequestException('order_id and payment_id are required');
    }
    this.getUserId(auth);
    const order = await this.ordersService.checkout(dto);
    return { success: true, data: { order } };
  }

  @Get()
  async listOrders(
    @Headers('authorization') auth: string,
    @Query('buyer_id') buyerIdQuery: string,
    @Query('page')     page: string,
    @Query('limit')    limit: string,
    @Query('status')   status: string,
  ) {
    const buyer_id = buyerIdQuery || this.getUserId(auth);
    const result = await this.ordersService.listOrders(buyer_id, {
      page:  parseInt(page)  || 1,
      limit: parseInt(limit) || 10,
      status,
    });
    return { success: true, data: result };
  }

  @Get(':id')
  async getOrder(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
  ) {
    const userId = this.getUserId(auth);
    const order  = await this.ordersService.getOrder(id, userId);
    return { success: true, data: { order } };
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelOrder(
    @Headers('authorization') auth: string,
    @Param('id')          id: string,
    @Body('reason')       reason: string,
    @Body('buyer_id')     buyerId: string,
  ) {
    const buyer_id = buyerId || this.getUserId(auth);
    const result   = await this.ordersService.cancelOrder(id, buyer_id, reason);
    return { success: true, data: result };
  }
}
