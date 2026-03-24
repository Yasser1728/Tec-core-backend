import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OrdersController } from './order.controller';
import { OrdersService }    from './order.service';

@Module({
  imports: [
    JwtModule.register({
      secret:     process.env.JWT_SECRET ?? 'secret',
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [OrdersController],
  providers:   [OrdersService],
  exports:     [OrdersService],
})
export class OrderModule {}
