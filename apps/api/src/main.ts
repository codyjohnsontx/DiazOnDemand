import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { validateApiEnv } from './config/env.js';

function useComingSoonWall(req: Request, res: Response, next: NextFunction) {
  const path = req.path || req.url.split('?')[0] || '/';
  const isInternalEntitlements = /^\/users\/[^/]+\/entitlements$/.test(path);
  const isAllowed =
    req.method === 'OPTIONS' ||
    path === '/webhooks/stripe' ||
    path === '/webhooks/mux' ||
    isInternalEntitlements;

  if (isAllowed) {
    next();
    return;
  }

  res.status(503).json({
    message: 'Diaz on Demand is coming soon.',
  });
}

async function bootstrap() {
  const env = validateApiEnv(process.env);
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const corsOrigins = env.CORS_ORIGIN
    .split(',')
    .map((origin) => origin.trim());

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  if (env.VOD_COMING_SOON === 'true') {
    app.use(useComingSoonWall);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Diaz On Demand API')
    .setDescription('MVP API for instructional platform')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = env.PORT;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
}

bootstrap();
