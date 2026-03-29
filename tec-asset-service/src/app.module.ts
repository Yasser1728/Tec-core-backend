import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssetModule } from './modules/asset/asset.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AssetModule,
    MarketplaceModule,
    HealthModule,
  ],
})
export class AppModule {}
