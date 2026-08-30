import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  const configService = app.get(ConfigService);
  const corsOrigins = configService.get<string>('CORS_ORIGINS');
  let origins: string | string[] = '*';
  if (corsOrigins && corsOrigins !== '*') {
    origins = corsOrigins.split(',');
  }

  app.enableCors({
    origin: origins,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
