import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.enableCors({
    origin: '*',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // ✅ بدون prefix — Gateway يتولى الـ routing
  // app.setGlobalPrefix('api/v1');  ← احذف هذا السطر

  const port = process.env.PORT || 5001;
  await app.listen(port);
  console.log(`TEC Auth Service running on port ${port}`);
}

bootstrap();
