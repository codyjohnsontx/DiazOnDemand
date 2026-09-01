import { PassThrough } from 'node:stream';
import type { NextFunction, Request, Response } from 'express';

/**
 * Repairs a request whose body stream the serverless runtime already read, so
 * that Express can still parse it and Nest's `rawBody` still holds the exact
 * bytes Stripe and Mux signed.
 *
 * Why this exists. Vercel's Node runtime can attach request helpers before
 * handing the request to the function - `req.body`, `req.query`, `req.cookies`.
 * Building `req.body` means draining the stream, and it replays the bytes
 * afterwards by patching `req.on` to read from a `PassThrough` (`restoreBody` in
 * `@vercel/node`). What the replay does not restore is `req.readable`, and that
 * is the flag everything downstream keys on:
 *
 *   - `on-finished`'s `isFinished(req)` is `req.complete && !req.readable`, so it
 *     reports the request as finished and body-parser returns immediately with
 *     "body already parsed" - never calling its `verify` callback, which is the
 *     only thing that sets `rawBody`;
 *   - `raw-body` refuses a stream whose `readable` is false outright.
 *
 * The result is a 400 "Missing stripe signature or raw body" on every webhook -
 * total failure of the one job the deployment exists to do. Reproduced locally
 * against this API; see serverless-raw-body.test.ts.
 *
 * Whether that path is live is not something this repository can settle. The
 * runtime skips its helpers for a listener that has a `listen` method, which is
 * why serverless.ts exports the Express instance itself rather than a wrapper -
 * but that branch lives in Vercel's deploy-time launcher, not in any package
 * installed here, so it cannot be verified without deploying. This middleware
 * removes the need to: the API behaves the same whether the runtime pre-read the
 * body or not.
 *
 * It is deliberately registered only by the serverless entrypoint. On the
 * long-running server the stream always arrives unread, `req.readable` is true,
 * and this returns before touching anything.
 */
export function restoreReadableBody(req: Request, _res: Response, next: NextFunction): void {
  // The ordinary case, and the only one on the long-running server: nothing has
  // read the stream, so Express reads it exactly as it always has.
  if (req.readable !== false) {
    next();
    return;
  }

  // The stream was drained. The bytes are recoverable only because the runtime
  // replayed them through an own `on` property; a runtime that drained without
  // replaying has lost them, and no middleware can invent them back. Fall
  // through in that case so the webhook routes answer their existing 400 rather
  // than hanging on an `end` event that already fired.
  if (!Object.prototype.hasOwnProperty.call(req, 'on')) {
    next();
    return;
  }

  const chunks: Buffer[] = [];
  let settled = false;

  const finish = (error?: Error) => {
    if (settled) {
      return;
    }
    settled = true;

    if (error) {
      next(error);
      return;
    }

    republishBody(req, Buffer.concat(chunks));
    next();
  };

  req.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  req.on('end', () => finish());
  req.on('error', (error: Error) => finish(error));
}

/**
 * Presents `raw` to the rest of the stack as a readable request body.
 *
 * The same replay `@vercel/node` performs, plus the `readable` flag it omits.
 * `readable` has to be defined as an own property rather than assigned: the
 * accessor on `Readable.prototype` derives its answer from `endEmitted`, which
 * is already true here, so a plain assignment would be silently ignored.
 */
function republishBody(req: Request, raw: Buffer): void {
  const replay = new PassThrough();
  const replayOn = replay.on.bind(replay);
  const originalOn = req.on.bind(req);

  Object.defineProperty(req, 'readable', { value: true, configurable: true, writable: true });

  req.read = replay.read.bind(replay) as Request['read'];
  req.on = req.addListener = ((event: string, listener: (...args: unknown[]) => void) =>
    event === 'data' || event === 'end'
      ? replayOn(event, listener)
      : originalOn(event, listener)) as unknown as Request['on'];

  replay.end(raw);
}
