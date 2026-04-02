import { Module }          from '@nestjs/common';
import { JwtModule }       from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'tec-dev-secret',
    }),
  ],
  providers: [RealtimeGateway],
  exports:   [RealtimeGateway],
})
export class RealtimeModule {}
