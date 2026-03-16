import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // يجعل Prisma متاحة في كل مكان دون الحاجة لعمل Import متكرر
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
