import 'reflect-metadata';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { validateApiEnv, type ApiEnv } from './config/env.js';

/**
 * Every way this API is served wires itself here, so the long-running server and
 * the serverless function cannot drift apart. `main.ts` calls this and then
 * `listen()`; `serverless.ts` calls this and then `init()`. The two entrypoints
 * differ in that one line and nothing else - routes, guards, pipes, CORS, the
 * coming-soon wall and Swagger are all decided in this file.
 */

/**
 * Turborepo does not load .env files into task environments, and ConfigModule
 * only reads the cwd (apps/api). Load the monorepo-root .env here, since
 * validateApiEnv runs before Nest bootstraps. loadEnvFile never overwrites a
 * variable that is already set, so real deployment env vars still win.
 *
 * Resolved from this module's own directory, which is `apps/api/dist` in a built
 * tree, so it finds the repository root from either entrypoint. A deployment has
 * no such file and lands in the catch - that is the normal case there, not a
 * failure.
 */
function loadRootEnvFile(): void {
  try {
    const distDir = dirname(fileURLToPath(import.meta.url));
    process.loadEnvFile(resolve(distDir, '../../..', '.env'));
  } catch {
    // No root .env (deployed environments provide real env vars) - carry on and
    // let validateApiEnv report anything that is actually missing.
  }
}

export function useComingSoonWall(req: Request, res: Response, next: NextFunction) {
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

/**
 * Builds the fully configured Nest application without starting it.
 *
 * Throws before creating anything when the environment is invalid, so a missing
 * secret is reported by name. On the long-running server that means the process
 * exits without opening a port; in a serverless function it means the module
 * fails to load and every invocation fails with the same named error, which is
 * the closest that runtime gets to refusing to start.
 */
export async function createApiApp(): Promise<{ app: INestApplication; env: ApiEnv }> {
  loadRootEnvFile();

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

  return { app, env };
}
