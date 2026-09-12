// The runner Expo documents for this SDK. `jest-expo` supplies the React Native
// transform, the asset transformer and the Expo module mocks; nothing else is added.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.tsx'],
  moduleNameMapper: {
    // `@diaz/shared` is ESM with an `import`-only `exports` map, which Jest's
    // CommonJS resolver cannot follow. Point at its TypeScript source, which Babel
    // transforms like any other file here, and drop the `.js` extensions ESM source
    // carries on its own relative imports.
    '^@diaz/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
