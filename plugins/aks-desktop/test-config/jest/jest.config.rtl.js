// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  rootDir: '../../', // Point to project root
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.rtl.test.tsx'],
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': [
      'babel-jest',
      {
        configFile: './test-config/babel/.babelrc.rtl.json',
      },
    ],
  },
  setupFilesAfterEnv: ['<rootDir>/test-config/setup/setupTests.js'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(gif|ttf|eot|svg|png)$': 'identity-obj-proxy',
  },
  testPathIgnorePatterns: ['/node_modules/', '/build/'],
  collectCoverageFrom: [
    'src/components/**/*.{ts,tsx}',
    '!src/components/**/*.d.ts',
    '!src/components/__tests__/**',
    '!src/components/**/index.{ts,tsx}',
  ],
  coverageDirectory: 'coverage-rtl',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  transformIgnorePatterns: ['node_modules/(?!(@testing-library|@iconify|@babel)/)'],
};
