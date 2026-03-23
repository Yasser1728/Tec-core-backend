import { Module } from '@nestjs/common';
import { OrdersController } from './order.controller'; // ← OrdersController
import { OrdersService }    from './order.service';    // ← OrdersService

@Module({
  controllers: [OrdersController],
  providers:   [OrdersService],
  exports:     [OrdersService],
})
export class OrderModule {}
