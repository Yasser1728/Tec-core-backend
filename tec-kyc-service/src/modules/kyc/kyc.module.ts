import { Module }        from '@nestjs/common';
import { JwtModule }     from '@nestjs/jwt';
import { KycController } from './kyc.controller';
import { KycService }    from './kyc.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'tec-dev-secret',
    }),
  ],
  controllers: [KycController],
  providers:   [KycService],
  exports:     [KycService],
})
export class KycModule {}
