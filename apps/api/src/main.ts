import { createApiApp } from './create-app.js';

/**
 * The long-running server entrypoint - `pnpm start` and `pnpm dev`. Everything
 * that configures the application lives in create-app.ts, shared with the
 * serverless entrypoint in serverless.ts, so the two cannot drift.
 */
async function bootstrap() {
  const { app, env } = await createApiApp();

  const port = env.PORT;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
}

bootstrap();
