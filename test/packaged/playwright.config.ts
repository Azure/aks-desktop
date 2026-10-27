// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: __dirname,
  testMatch: 'theme.spec.ts',
  outputDir: './test-results',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  forbidOnly: !!process.env.CI,
});
