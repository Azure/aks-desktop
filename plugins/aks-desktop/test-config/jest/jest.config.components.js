// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
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
  coverageDirectory: 'coverage/components',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 10000,
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons'],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
