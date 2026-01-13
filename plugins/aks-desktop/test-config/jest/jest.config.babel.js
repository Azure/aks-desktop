// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  rootDir: '../../', // Point to project root
  setupFilesAfterEnv: ['<rootDir>/test-config/setup/setupTests-main.ts'],
  moduleNameMapper: {
    '^@kinvolk/headlamp-plugin/lib$': '<rootDir>/src/utils/test/__mocks__/headlamp-plugin.js',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  testMatch: [
    '<rootDir>/src/components/**/__tests__/**/*.test.{ts,tsx}',
    '<rootDir>/src/components/**/*.test.{ts,tsx}',
    '<rootDir>/src/components/**/__tests__/**/*.spec.{ts,tsx}',
    '<rootDir>/src/components/**/*.spec.{ts,tsx}',
  ],
  collectCoverageFrom: [
    'src/components/**/*.{ts,tsx}',
    '!src/components/**/__tests__/**',
    '!src/components/**/*.d.ts',
    '!src/components/**/index.{ts,tsx}',
  ],
  coverageDirectory: 'coverage/components-babel',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 10000,

  // Babel-based transformation
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': [
      'babel-jest',
      {
        configFile: './.babelrc.test.json',
      },
    ],
  },

  // Babel-specific optimizations
  transformIgnorePatterns: ['node_modules/(?!(@testing-library|@iconify))'],

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Enhanced error reporting with Babel
  verbose: true,
  errorOnDeprecated: true,
};
