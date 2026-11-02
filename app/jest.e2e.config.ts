/**
 * @jest-config-loader ts-node
 */
import type { Config } from 'jest';

import { coverageExclusions, moduleNameMapper } from './jest.config';

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  roots: ['<rootDir>/test/e2e'],
  testRegex: '\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { diagnostics: { ignoreCodes: [151002] } }],
  },
  moduleNameMapper,
  collectCoverageFrom: ['src/**/*.ts', ...coverageExclusions],
  coverageDirectory: 'coverage/e2e',
  coverageReporters: ['text-summary', 'lcov'],
  testTimeout: 300_000,
};

export default config;
