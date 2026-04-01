import { Module }                  from '@nestjs/common';
import { NotificationController }  from './notification.controller';
import { DeviceTokenController }   from './device-token.controller';
import { NotificationService }     from './notification.service';
import { FcmService }              from './fcm.service';

@Module({
  controllers: [NotificationController, DeviceTokenController],
  providers:   [NotificationService, FcmService],
  exports:     [NotificationService],
})
export class NotificationModule {}
