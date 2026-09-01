// Vercel's Node runtime discovers functions by file path, and this is the only
// path it looks at: `api/index.js` under the project root, which vercel.json
// then rewrites every request to.
//
// It is hand-written JavaScript, not TypeScript, on purpose. Vercel transpiles a
// function entrypoint with esbuild, and esbuild cannot emit the decorator
// metadata Nest's dependency injection reads. So nothing that Nest has to
// understand may be compiled by it: `nest build` (tsc, with
// emitDecoratorMetadata) produces dist/, and this file only forwards to the
// already-built output. Keeping it out of src/ also keeps it out of
// tsconfig.json's `include`, so `nest build` cannot start emitting dist/api/ and
// move dist/main.js out from under `pnpm start`.
export { default } from '../dist/serverless.js';
