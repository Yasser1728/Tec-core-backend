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
      useFactory: (config: ConfigService) => {
        const rawKey = config.get<string>('JWT_PRIVATE_KEY');
        const secret = config.get<string>('JWT_SECRET', 'tec-dev-secret');

        // ── تحويل \n literal → newline حقيقي ──────────────────
        const privateKey = rawKey
          ?.replace(/\\n/g, '\n')
          ?.trim();

        // ── تحقق إن الـ key صالح فعلاً ──────────────────────
        const isValidPem = privateKey?.includes('-----BEGIN') &&
                           privateKey?.includes('PRIVATE KEY-----');

        if (isValidPem) {
          return {
            privateKey,
            signOptions: { algorithm: 'RS256', expiresIn: '24h' },
          };
        }

        // ── Fallback: HS256 ───────────────────────────────────
        return {
          secret,
          signOptions: { algorithm: 'HS256', expiresIn: '24h' },
        };
      },
    }),
  ],
  providers:   [AuthService],
  controllers: [AuthController],
  exports:     [AuthService],
})
export class AuthModule {}
