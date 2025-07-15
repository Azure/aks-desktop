// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '../../', // Point to project root
  moduleNameMapper: {
    '^@kinvolk/headlamp-plugin/lib$': '<rootDir>/src/utils/test/__mocks__/headlamp-plugin.js',
    '^@kinvolk/headlamp-plugin/lib/ApiProxy$':
      '<rootDir>/src/utils/test/__mocks__/headlamp-apiproxy.js',
    '^@kinvolk/headlamp-plugin/lib/Utils$': '<rootDir>/src/utils/test/__mocks__/headlamp-utils.js',
  },
  testMatch: [
    '<rootDir>/src/utils/test/**/*.test.ts',
    '<rootDir>/src/utils/test/**/*.test.js',
    '<rootDir>/src/utils/test/**/*.spec.ts',
    '<rootDir>/src/utils/test/**/*.spec.js',
  ],
  collectCoverageFrom: ['src/utils/**/*.ts', '!src/utils/test/**', '!src/utils/**/*.d.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 10000,
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  // Transform ES modules from node_modules
  transformIgnorePatterns: ['node_modules/(?!@kinvolk/headlamp-plugin)'],
};
