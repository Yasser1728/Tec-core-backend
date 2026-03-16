import { Module } from '@nestjs/common';
import { AssetService } from './asset.service';
import { AssetController } from './asset.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    // Database access shared within the asset module context
    PrismaModule
  ],
  controllers: [
    // Handles HTTP routing and validation
    AssetController
  ],
  providers: [
    // Contains the business logic and database transactions
    AssetService
  ],
  exports: [
    // Exporting the service allows other modules (like Payments or Notifications) 
    // to interact with assets if they are imported into this service
    AssetService
  ],
})
export class AssetModule {}
