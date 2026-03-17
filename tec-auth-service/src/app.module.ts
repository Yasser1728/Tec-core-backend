import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { requestIdMiddleware } from './middleware/request-id';

@Module({
  imports: [
    // 1. Global configuration and environment variables
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),

    // 2. Infrastructure modules (Prisma ORM)
    PrismaModule,

    // 3. Service modules
    AuthModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule implements NestModule {
  // Apply legacy middleware (Request ID) for tracing/log correlation
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(requestIdMiddleware)
      .forRoutes('*');
  }
}
