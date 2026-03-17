// src/infra/prisma/prisma.module.ts

import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PrismaModule
 * ───────────────
 * Global module to provide PrismaService across the entire application.
 * This allows any module to inject PrismaService without importing PrismaModule again.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService], // Export for DI in other modules
})
export class PrismaModule {}
