import { Module }     from '@nestjs/common';
import { JwtModule }  from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService }    from './analytics.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:       config.get<string>('JWT_SECRET'),
        signOptions:  { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AnalyticsController],
  providers:   [AnalyticsService],
  exports:     [AnalyticsService],
})
export class AnalyticsModule {}
