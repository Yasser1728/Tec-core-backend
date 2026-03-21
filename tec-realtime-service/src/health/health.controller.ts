import { Controller, Get } from '@nestjs/common';
import { RealtimeGateway } from '../gateway/realtime.gateway';

@Controller()
export class HealthController {
  private readonly startTime = Date.now();

  constructor(private readonly gateway: RealtimeGateway) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'realtime-service',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      connectedUsers: this.gateway.getConnectedCount(),
    };
  }

  @Get('ready')
  ready() {
    return {
      status: 'ready',
      service: 'realtime-service',
    };
  }
}
