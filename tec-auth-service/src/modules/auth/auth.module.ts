import { Module }                         from '@nestjs/common';
import { JwtModule }                      from '@nestjs/jwt';
import { ConfigModule, ConfigService }    from '@nestjs/config';
import { AuthService }                    from './auth.service';
import { AuthController }                 from './auth.controller';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => {
        const privateKey = config.get<string>('JWT_PRIVATE_KEY')
          ?.replace(/\\n/g, '\n');

        // ── Fallback: HS256 لو مفيش keys (dev بدون config) ──
        if (!privateKey) {
          return {
            secret:      config.get<string>('JWT_SECRET', 'tec-dev-secret'),
            signOptions: { expiresIn: '24h', algorithm: 'HS256' },
          };
        }

        return {
          privateKey,
          signOptions: { expiresIn: '24h', algorithm: 'RS256' },
        };
      },
    }),
  ],
  providers:   [AuthService],
  controllers: [AuthController],
  exports:     [AuthService],
})
export class AuthModule {}
