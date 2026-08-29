import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': '@swc/jest',
  },
  // Nest 12 packages are ESM-only; @swc/jest needs to transform them so
  // CJS test files can require() them. Same exception list as the e2e
  // and RLS jest configs (apps/api/test/jest-e2e.json,
  // apps/api/test/jest-rls.json).
  transformIgnorePatterns: ['node_modules/(?!(@nestjs|@swc|jose)/)'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/../test/setup-env.ts'],
};

export default config;
