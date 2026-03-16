import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssetModule } from './modules/asset/asset.module';
import { PrismaModule } from './modules/prisma/prisma.module';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { 
      status: 'ok', 
      service: 'TEC Asset Service',
      timestamp: new Date().toISOString() 
    };
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
