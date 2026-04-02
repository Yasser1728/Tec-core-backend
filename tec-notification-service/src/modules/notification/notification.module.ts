import { Module }                  from '@nestjs/common';
import { JwtModule }               from '@nestjs/jwt';
import { NotificationController }  from './notification.controller';
import { DeviceTokenController }   from './device-token.controller';
import { NotificationService }     from './notification.service';
import { FcmService }              from './fcm.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'tec-dev-secret',
    }),
  ],
  controllers: [NotificationController, DeviceTokenController],
  providers:   [NotificationService, FcmService],
  exports:     [NotificationService],
})
export class NotificationModule {}
