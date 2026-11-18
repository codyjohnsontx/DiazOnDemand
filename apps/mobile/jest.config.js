// The runner Expo documents for this SDK. `jest-expo` supplies the React Native
// transform, the asset transformer and the Expo module mocks; nothing else is added.
module.exports = {
  preset: 'jest-expo',
  // React Native's index requires its components lazily, so the first render in each
  // file pays to transform them inside that test's budget: measured at 0.4s with a warm
  // cache and up to 16s cold under CPU contention, and CI is always cold. Jest's default 5s
  // then fails a test with nothing wrong with it.
  testTimeout: 30000,
  moduleNameMapper: {
    // `@diaz/shared` is ESM with an `import`-only `exports` map, which Jest's
    // CommonJS resolver cannot follow. Point at its TypeScript source, which Babel
    // transforms like any other file here, and drop the `.js` extensions ESM source
    // carries on its own relative imports.
    '^@diaz/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
