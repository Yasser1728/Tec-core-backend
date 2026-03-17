// src/modules/health/health.controller.ts

import { Controller, Get, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Basic health check (liveness probe)
   */
  @Get()
  async check() {
    const start = Date.now();

    let dbStatus: 'up' | 'down' = 'up';
    let latency = 0;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      latency = Date.now() - start;
    } catch (error) {
      dbStatus = 'down';
      latency = Date.now() - start;
    }

    const isHealthy = dbStatus === 'up';

    return {
      status: isHealthy ? 'ok' : 'error',
      service: 'tec-auth-service',
      timestamp: new Date().toISOString(),
      latency, // in ms
      checks: {
        database: {
          status: dbStatus,
          latency,
        },
      },
    };
  }

  /**
   * Readiness probe (used by Kubernetes / load balancers)
   */
  @Get('ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: 'ready',
        service: 'tec-auth-service',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'not_ready',
        service: 'tec-auth-service',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
