import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  app.use('/payments/webhook', express.raw({ type: 'application/json' }));
  app.use(
    express.json({
      limit: '2mb',
      verify: (req: { rawBody?: Buffer }, _res: unknown, buffer: Buffer) => {
        req.rawBody = buffer;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));

  const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);

  Logger.log(`API running on http://localhost:${port}`, 'Bootstrap');
}

bootstrap();
