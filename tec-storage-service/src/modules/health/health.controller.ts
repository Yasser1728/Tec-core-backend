import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  private readonly startTime = Date.now();

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'storage-service',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  @Get('ready')
  ready() {
    return {
      status: 'ready',
      service: 'storage-service',
      timestamp: new Date().toISOString(),
    };
  }
}
