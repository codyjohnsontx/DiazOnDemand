import { createApiApp } from './create-app.js';
import { restoreReadableBody } from './serverless-raw-body.js';

/**
 * The serverless entrypoint. `api/index.js` re-exports this module's default
 * export, and Vercel's Node runtime treats an exported Express instance as the
 * request handler for the function.
 *
 * Two things are deliberate here.
 *
 * Top-level await, rather than a handler that lazily boots on first request.
 * The runtime awaits `import()` of the entrypoint before dispatching anything,
 * so Nest is fully initialised before the first request rather than racing it,
 * and one instance boots once and then serves every warm invocation. It also
 * keeps the failure mode honest: an invalid environment throws out of
 * `createApiApp`, the module never finishes loading, and every invocation fails
 * naming the missing variable - the serverless equivalent of the server
 * refusing to open a port.
 *
 * `init()` rather than `listen()`. It runs the same lifecycle - middleware,
 * routes, guards, `onModuleInit` - and stops short of binding a port, which a
 * function may not do. The Express instance underneath is then fully wired.
 *
 * Exporting the Express instance rather than an `(req, res)` wrapper is also
 * deliberate: Vercel skips its request helpers for a listener that has a
 * `listen` method, so the request stream reaches Express unread and Nest's
 * `rawBody` capture sees the bytes Stripe and Mux actually signed.
 * `restoreReadableBody` makes that an optimisation rather than a dependency -
 * see the comment on it for what breaks if the runtime reads the body first.
 */
const { app } = await createApiApp();

// Registered after createApiApp and before init() on purpose: Nest attaches its
// body parsers during init(), and this has to repair the stream before they run.
app.use(restoreReadableBody);

await app.init();

export default app.getHttpAdapter().getInstance();
