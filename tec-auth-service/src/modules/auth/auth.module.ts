import { Module }                      from '@nestjs/common';
import { JwtModule }                   from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService }                 from './auth.service';
import { AuthController }              from './auth.controller';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:      config.get<string>('JWT_SECRET', 'tec-dev-secret'),
        signOptions: { algorithm: 'HS256', expiresIn: '24h' },
      }),
    }),
  ],
  providers:   [AuthService],
  controllers: [AuthController],
  exports:     [AuthService],
})
export class AuthModule {}
