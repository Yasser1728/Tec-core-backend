import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'asset-service' };
  }

  @Get('ready')
  ready() {
    return { status: 'ready' };
  }
}
