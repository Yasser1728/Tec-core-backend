import { Module } from '@nestjs/common';
import { OrdersController } from './order.controller';
import { OrdersService }    from './order.service';

@Module({
  controllers: [OrdersController],
  providers:   [OrdersService],
  exports:     [OrdersService],
})
export class OrderModule {}
