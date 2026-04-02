import { Module }            from '@nestjs/common';
import { JwtModule }         from '@nestjs/jwt';
import { StorageController } from './storage.controller';
import { StorageService }    from './storage.service';
import { R2Service }         from './r2.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'tec-dev-secret',
    }),
  ],
  controllers: [StorageController],
  providers:   [StorageService, R2Service],
  exports:     [StorageService, R2Service],
})
export class StorageModule {}
