import { Module }            from '@nestjs/common';
import { JwtModule }         from '@nestjs/jwt';
import { ProductController } from './product.controller';
import { ProductService }    from './product.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'tec-dev-secret',
    }),
  ],
  controllers: [ProductController],
  providers:   [ProductService],
  exports:     [ProductService],
})
export class ProductModule {}
