import 'reflect-metadata';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { validateApiEnv } from './config/env.js';

// Turborepo does not load .env files into task environments, and ConfigModule
// only reads the cwd (apps/api). Load the monorepo-root .env here, since
// validateApiEnv runs before Nest bootstraps. loadEnvFile never overwrites a
// variable that is already set, so real deployment env vars still win.
try {
  const distDir = dirname(fileURLToPath(import.meta.url));
  process.loadEnvFile(resolve(distDir, '../../..', '.env'));
} catch {
  // No root .env (deployed environments provide real env vars) - carry on and
  // let validateApiEnv report anything that is actually missing.
}

function useComingSoonWall(req: Request, res: Response, next: NextFunction) {
  const path = req.path || req.url.split('?')[0] || '/';
  const isInternalEntitlements = /^\/users\/[^/]+\/entitlements$/.test(path);
  const isAllowed =
    req.method === 'OPTIONS' ||
    // Platform liveness probes must not see a 503, or the host marks the service
    // unhealthy and restarts a process that is working fine.
    path === '/health' ||
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
