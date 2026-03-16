import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssetModule } from './modules/asset/asset.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { HealthController } from './health.controller'; // تأكدي أن الملف بهذا الاسم موجود داخل src

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AssetModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
