import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { R2Service } from './r2.service';

@Module({
  controllers: [StorageController],
  providers: [StorageService, R2Service],
  exports: [StorageService, R2Service],
})
export class StorageModule {}
