import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { Controller, Module, Post, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Request, RequestHandler } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { restoreReadableBody } from '../serverless-raw-body.js';

/**
 * The defect this pins, reproduced before it was fixed: when a serverless
 * runtime reads the request body before handing the request to the application,
 * Nest's `rawBody` is never populated and both webhook routes answer 400
 * "Missing signature or raw body" - so no Stripe payment and no Mux upload ever
 * reaches the database.
 *
 * The application is a real Nest app created the way createApiApp creates the
 * production one - `rawBody: true`, so the same body parsers and the same
 * `verify` callback - rather than a hand-rolled Express stack, because the thing
 * under test is precisely how those parsers react to a pre-read stream.
 */

@Controller()
class RawBodyEchoController {
  @Post('echo')
  echo(@Req() req: Request) {
    return {
      hasRawBody: Boolean(req.rawBody),
      raw: req.rawBody?.toString('utf8') ?? null,
      body: req.body,
    };
  }
}

@Module({ controllers: [RawBodyEchoController] })
class RawBodyEchoModule {}

/**
 * Vercel's request helpers, transcribed from `@vercel/node`'s `readBody` and
 * `restoreBody`. It drains the stream to build `req.body`, then replays the
 * bytes through a patched `req.on` - and leaves `req.readable` false, which is
 * the whole defect.
 */
async function applyVercelRequestHelpers(req: Request): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }

  const replicateBody = new PassThrough();
  const on = replicateBody.on.bind(replicateBody);
  const originalOn = req.on.bind(req);
  req.read = replicateBody.read.bind(replicateBody) as Request['read'];
  req.on = req.addListener = ((name: string, cb: (...args: unknown[]) => void) =>
    name === 'data' || name === 'end' ? on(name, cb) : originalOn(name, cb)) as unknown as Request['on'];
  replicateBody.write(Buffer.concat(chunks));
  replicateBody.end();
}

interface Harness {
  url: string;
  close: () => Promise<void>;
}

async function startHarness(options: {
  withMiddleware: boolean;
  preReadBody: boolean;
}): Promise<Harness> {
  const app: INestApplication = await NestFactory.create(RawBodyEchoModule, {
    rawBody: true,
    logger: false,
  });

  if (options.withMiddleware) {
    app.use(restoreReadableBody as RequestHandler);
  }

  await app.init();

  const expressInstance = app.getHttpAdapter().getInstance();

  const server: Server = createServer((req, res) => {
    if (!options.preReadBody) {
      expressInstance(req, res);
      return;
    }

    void applyVercelRequestHelpers(req as unknown as Request).then(() => {
      expressInstance(req, res);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await app.close();
    },
  };
}

// Whitespace and a newline on purpose: a signature is computed over the exact
// bytes, so a body that survives only as re-serialised JSON is already broken.
const PAYLOAD = '{\n  "type": "video.asset.ready",\n  "spaced":  "  x  "\n}';

async function post(url: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${url}/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: PAYLOAD,
  });

  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe('restoreReadableBody', () => {
  it('leaves an unread request stream alone', async () => {
    harness = await startHarness({ withMiddleware: true, preReadBody: false });

    const { status, json } = await post(harness.url);

    expect(status).toBe(201);
    expect(json.hasRawBody).toBe(true);
    expect(json.raw).toBe(PAYLOAD);
    expect(json.body).toMatchObject({ type: 'video.asset.ready' });
  });

  it('recovers the raw body when the runtime read the stream first', async () => {
    harness = await startHarness({ withMiddleware: true, preReadBody: true });

    const { status, json } = await post(harness.url);

    expect(status).toBe(201);
    expect(json.hasRawBody).toBe(true);
    // Byte-identical, not merely equivalent JSON - this is what gets signed.
    expect(json.raw).toBe(PAYLOAD);
    expect(json.body).toMatchObject({ type: 'video.asset.ready' });
  });

  it('reproduces the failure it exists to prevent when it is not installed', async () => {
    harness = await startHarness({ withMiddleware: false, preReadBody: true });

    const { json } = await post(harness.url);

    // Without the middleware, on-finished reports the request as already
    // finished, body-parser returns without calling its verify callback, and
    // nothing sets rawBody - which is a 400 on every webhook delivery.
    expect(json.hasRawBody).toBe(false);
  });
});
