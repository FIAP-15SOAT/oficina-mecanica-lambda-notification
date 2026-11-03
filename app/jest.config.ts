import type { Config } from 'jest';

export const moduleNameMapper = {
  '^@application/(.*)$': '<rootDir>/src/application/$1',
  '^@domain/(.*)$': '<rootDir>/src/domain/$1',
  '^@infrastructure/(.*)$': '<rootDir>/src/infrastructure/$1',
  '^@interface-adapters/(.*)$': '<rootDir>/src/interface-adapters/$1',
  '^@test/(.*)$': '<rootDir>/test/$1',
};

export const coverageExclusions = [
  '!src/bootstrap.ts',
  '!src/**/*.interface.ts',
  '!src/**/*.catalog.ts',
];

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  roots: ['<rootDir>/src', '<rootDir>/test/unit'],
  testRegex: '\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { diagnostics: { ignoreCodes: [151002] } }],
  },
  moduleNameMapper,
  collectCoverageFrom: ['src/**/*.ts', ...coverageExclusions],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov'],
  coverageThreshold: {
    global: {
      lines: 100,
      statements: 100,
      functions: 100,
      branches: 100,
    },
  },
};

export default config;
