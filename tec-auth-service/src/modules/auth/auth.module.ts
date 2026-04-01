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
        const privateKey = config.get<string>('JWT_PRIVATE_KEY')
          ?.replace(/\\n/g, '\n');
        const secret     = config.get<string>('JWT_SECRET', 'tec-dev-secret');

        if (privateKey) {
          return {
            privateKey,
            signOptions: { algorithm: 'RS256', expiresIn: '24h' },
          };
        }

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
