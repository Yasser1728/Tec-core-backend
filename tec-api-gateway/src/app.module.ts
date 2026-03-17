import { Module } from '@nestjs/common';
import { ProxyService } from './modules/proxy/proxy.service';

@Module({
  imports: [],
  controllers: [],
  providers: [ProxyService], // إضافة الـ Service هنا لكي يتمكن الـ Gateway من استخدامه
  exports: [ProxyService],
})
export class AppModule {}
