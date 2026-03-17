// src/infra/prisma/prisma.service.ts

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { logger } from '../logger';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },   // Capture queries for monitoring
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });

    // Optional: log all queries with parameters
    this.$on('query', (e) => {
      logger.info(`[Prisma Query] ${e.query} | Params: ${JSON.stringify(e.params)}`);
    });
  }

  /**
   * Connect to the database when module initializes
   */
  async onModuleInit() {
    try {
      await this.$connect();
      logger.info('🐘 Prisma: Successfully connected to the database.');
    } catch (error) {
      logger.error('❌ Prisma: Failed to connect to the database.', error);
      process.exit(1); // Stop the service if DB connection fails
    }
  }

  /**
   * Disconnect from the database when module is destroyed
   */
  async onModuleDestroy() {
    await this.$disconnect();
    logger.info('🐘 Prisma: Disconnected from the database.');
  }
}
