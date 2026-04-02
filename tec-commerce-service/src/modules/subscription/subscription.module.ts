import { Module }                  from '@nestjs/common';
import { JwtModule }               from '@nestjs/jwt';
import { SubscriptionController }  from './subscription.controller';
import { SubscriptionService }     from './subscription.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'tec-dev-secret',
    }),
  ],
  controllers: [SubscriptionController],
  providers:   [SubscriptionService],
  exports:     [SubscriptionService],
})
export class SubscriptionModule {}
