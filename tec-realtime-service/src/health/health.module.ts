import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { RealtimeModule } from '../gateway/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [HealthController],
})
export class HealthModule {}
