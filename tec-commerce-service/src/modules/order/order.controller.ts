import { Module }           from '@nestjs/common';
import { OrdersController } from './order.controller';
import { OrdersService }    from './order.service';
import { OrderConsumer }    from './order.consumer';

@Module({
  controllers: [OrdersController],
  providers:   [OrdersService, OrderConsumer],
  exports:     [OrdersService],
})
export class OrderModule {}
