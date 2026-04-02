import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeModule } from './gateway/realtime.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret || secret.length < 32) {
          throw new Error('FATAL: JWT_SECRET environment variable must be set (minimum 32 characters)');
        }
        return { secret, global: true, signOptions: { algorithm: 'HS256' } };
      },
    }),
    RealtimeModule,
    HealthModule,
  ],
})
export class AppModule {}
