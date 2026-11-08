// The runner Expo documents for this SDK. `jest-expo` supplies the React Native
// transform, the asset transformer and the Expo module mocks; nothing else is added.
module.exports = {
  preset: 'jest-expo',
  // React Native's components are required lazily, so a suite's first render is what
  // Babel-transforms them, inside that test's budget. On a cold transform cache (every
  // CI run) with turbo running the other workspaces' tests alongside, that one render
  // has taken over 7s, past Jest's 5s default, while the same test takes under 100ms
  // warm. The timeout covers the transform; it does not let a hung test hang longer
  // than this.
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
