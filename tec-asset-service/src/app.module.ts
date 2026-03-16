import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssetModule } from './modules/asset/asset.module';
import { PrismaModule } from './modules/prisma/prisma.module';

// Health Controller مباشر داخل الملف لضمان عدم حدوث خطأ في المسارات
@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}

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
