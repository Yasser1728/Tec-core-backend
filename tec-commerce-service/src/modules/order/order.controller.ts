import {
  Controller, Get, Post, Patch, Body, Param, Query,
  Headers, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { OrdersService, CreateOrderDto, CheckoutDto } from './order.service';

@Controller('commerce/orders') // ← كان 'orders' — أضفنا commerce/
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrder(
    @Body() body: CreateOrderDto & { buyer_id: string },
    @Headers('x-user-id') userId: string,
  ) {
    const buyer_id = body.buyer_id || userId;
    if (!buyer_id) throw new BadRequestException('buyer_id is required');
    const order = await this.ordersService.createOrder({ ...body, buyer_id });
    return { success: true, data: { order } };
  }

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  async checkout(@Body() dto: CheckoutDto) {
    if (!dto.order_id || !dto.payment_id) {
      throw new BadRequestException('order_id and payment_id are required');
    }
    const order = await this.ordersService.checkout(dto);
    return { success: true, data: { order } };
  }

  @Get()
  async listOrders(
    @Query('buyer_id') buyer_id: string,
    @Query('page')     page: string,
    @Query('limit')    limit: string,
    @Query('status')   status: string,
    @Headers('x-user-id') userId: string,
  ) {
    const id = buyer_id || userId;
    if (!id) throw new BadRequestException('buyer_id is required');
    const result = await this.ordersService.listOrders(id, {
      page:  parseInt(page)  || 1,
      limit: parseInt(limit) || 10,
      status,
    });
    return { success: true, data: result };
  }

  @Get(':id')
  async getOrder(
    @Param('id')          id: string,
    @Headers('x-user-id') userId: string,
  ) {
    const order = await this.ordersService.getOrder(id, userId);
    return { success: true, data: { order } };
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelOrder(
    @Param('id')          id: string,
    @Body('reason')       reason: string,
    @Headers('x-user-id') userId: string,
    @Body('buyer_id')     buyerId: string,
  ) {
    const buyer_id = buyerId || userId;
    if (!buyer_id) throw new BadRequestException('buyer_id is required');
    const result = await this.ordersService.cancelOrder(id, buyer_id, reason);
    return { success: true, data: result };
  }
}
