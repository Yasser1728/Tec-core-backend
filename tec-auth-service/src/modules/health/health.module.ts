// src/modules/health/health.module.ts

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaModule } from '../../infra/prisma/prisma.module';

/**
 * HealthModule
 * ───────────────
 * Provides system health, readiness, and monitoring endpoints.
 */
@Module({
  imports: [
    PrismaModule, // Ensure PrismaService is available for DI
  ],
  controllers: [HealthController],
  providers: [],
  exports: [],
})
export class HealthModule {}
