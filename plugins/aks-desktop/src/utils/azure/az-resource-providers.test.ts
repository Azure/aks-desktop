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

import { registerContainerServiceProvider } from './az-resource-providers';

describe('registerContainerServiceProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('registers the provider for the given subscription', async () => {
    mocks.runCommandAsync.mockResolvedValue({ stdout: '', stderr: '' });

    await expect(registerContainerServiceProvider('sub-123')).resolves.toEqual({
      success: true,
      data: undefined,
    });

    expect(mocks.runCommandAsync).toHaveBeenCalledWith('az', [
      'provider',
      'register',
      '-n',
      'Microsoft.ContainerService',
      '--subscription',
      'sub-123',
    ]);
  });

  test('omits --subscription when no subscription is provided', async () => {
    mocks.runCommandAsync.mockResolvedValue({ stdout: '', stderr: '' });

    await registerContainerServiceProvider();

    expect(mocks.runCommandAsync).toHaveBeenCalledWith('az', [
      'provider',
      'register',
      '-n',
      'Microsoft.ContainerService',
    ]);
  });

  test('surfaces a generic Azure CLI error', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '',
      stderr: 'ERROR: something went wrong',
    });

    await expect(registerContainerServiceProvider('sub-123')).resolves.toEqual({
      success: false,
      error: 'Failed to register Microsoft.ContainerService provider: ERROR: something went wrong',
    });
  });

  // This is the behaviour the old hand-rolled runRegistrationCommand lacked: it only
  // checked isAzError, so an expired token produced a raw stderr dump instead of the
  // actionable relogin message every other az call gives via runAzCommand.
  test('surfaces the actionable relogin message when the CLI session has expired', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '',
      stderr: 'Please run "az login" to setup account.',
    });

    await expect(registerContainerServiceProvider('sub-123')).resolves.toEqual({
      success: false,
      error: 'Authentication required. Please log in to Azure CLI: az login',
    });
  });
});
