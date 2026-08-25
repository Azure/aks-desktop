// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runCommandAsync: vi.fn(),
}));

vi.mock('../shared/runCommandAsync', () => ({
  runCommandAsync: mocks.runCommandAsync,
}));

vi.mock('./az-cli-path', () => ({
  getAzCommand: () => 'az',
  getInstallationInstructions: () => 'Install Azure CLI.',
}));

import { getLoginStatus } from './az-auth';

describe('getLoginStatus relogin detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  test('recognizes the standard signed-out Azure CLI response', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '',
      stderr: 'Please run "az login" to setup account.',
    });

    await expect(getLoginStatus()).resolves.toEqual({
      error: 'Please run "az login" to setup account.',
      isLoggedIn: false,
      needsRelogin: true,
    });
  });
});
