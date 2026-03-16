import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssetModule } from './modules/asset/asset.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    // 1. Global Configuration
    ConfigModule.forRoot({
      isGlobal: true, 
      envFilePath: process.env.NODE_ENV === 'development' ? '.env' : undefined,
      // Load and validate environment variables can be added here
    }),

    // 2. Database Layer (Shared across the service)
    PrismaModule,

    // 3. Domain Logic
    AssetModule,

    // 4. Infrastructure (Essential for Railway/Kubernetes)
    HealthModule, 
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
