import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OrderService } from './order.service';

@Controller('commerce/orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly jwtService: JwtService,
  ) {}

  private getUserId(authorization: string): string {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = authorization.replace('Bearer ', '');
    try {
      const decoded = this.jwtService.verify(token) as any;
      return decoded.sub ?? decoded.id;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  // POST /commerce/orders
  @Post()
  async createOrder(
    @Headers('authorization') auth: string,
    @Body() body: {
      items: { productId: string; quantity: number }[];
    },
  ) {
    const buyerId = this.getUserId(auth);
    const order = await this.orderService.createOrder({
      buyerId,
      items: body.items,
    });
    return { success: true, data: { order } };
  }

  // GET /commerce/orders
  @Get()
  async getUserOrders(@Headers('authorization') auth: string) {
    const buyerId = this.getUserId(auth);
    const orders = await this.orderService.getUserOrders(buyerId);
    return { success: true, data: { orders } };
  }

  // GET /commerce/orders/:id
  @Get(':id')
  async getOrder(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
  ) {
    const buyerId = this.getUserId(auth);
    const order = await this.orderService.getOrder(id, buyerId);
    return { success: true, data: { order } };
  }
}
