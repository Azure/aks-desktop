// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// REST capability projections are covered in az-managed-clusters.test.ts.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const command = vi.hoisted(() => vi.fn());
vi.stubGlobal('pluginRunCommand', command);
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ runCommand: command }));
vi.mock('../azure/az-cli-path', () => ({
  getAzCommand: () => 'az',
  getInstallationInstructions: () => 'Install Azure CLI',
}));

import { enableClusterAddon } from '../azure/az-clusters';

const options = {
  subscriptionId: 'test-sub-123',
  resourceGroup: 'test-rg',
  clusterName: 'test-cluster',
};

function processOutput(stdout: string, stderr = '') {
  return {
    stdout: {
      on: vi.fn((event: string, callback: (data: string) => void) => {
        if (event === 'data') callback(stdout);
      }),
    },
    stderr: {
      on: vi.fn((event: string, callback: (data: string) => void) => {
        if (event === 'data') callback(stderr);
      }),
    },
    on: vi.fn((event: string, callback: (code: number) => void) => {
      if (event === 'exit') callback(0);
    }),
  };
}

beforeEach(() => command.mockReset());

describe('enableClusterAddon', () => {
  test.each([
    ['azure-monitor-metrics', '--enable-azure-monitor-metrics'],
    ['keda', '--enable-keda'],
    ['vpa', '--enable-vpa'],
  ] as const)('retains the %s CLI write', async (addon, flag) => {
    command.mockReturnValue(processOutput(''));
    expect(await enableClusterAddon({ ...options, addon })).toEqual({ success: true });
    expect(command).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining([
        'aks',
        'update',
        '--subscription',
        options.subscriptionId,
        '--resource-group',
        options.resourceGroup,
        '--name',
        options.clusterName,
        flag,
        '--no-wait',
      ]),
      expect.anything()
    );
  });

  test.each([
    'Interactive authentication is needed. Please run: az login',
    'AADSTS50173: Token expired',
  ])('reports authentication failures: %s', async stderr => {
    command.mockReturnValue(processOutput('', stderr));
    expect(await enableClusterAddon({ ...options, addon: 'keda' })).toMatchObject({
      success: false,
      error: expect.stringContaining('Authentication required'),
    });
  });

  test.each([
    'ERROR: (ResourceNotFound) The Resource was not found.',
    'WARNING: something changed\nERROR: operation failed',
  ])('reports CLI write failures: %s', async stderr => {
    command.mockReturnValue(processOutput('', stderr));
    expect(await enableClusterAddon({ ...options, addon: 'keda' })).toMatchObject({
      success: false,
      error: expect.stringContaining('Failed to enable addons'),
    });
  });

  test.each([
    'WARNING: The behavior of this command has been altered.',
    'WARNING: The behavior has changed due to an error in the config',
  ])('does not fail writes for warnings: %s', async stderr => {
    command.mockReturnValue(processOutput('', stderr));
    expect(await enableClusterAddon({ ...options, addon: 'keda' })).toEqual({ success: true });
  });

  test('combines multiple addons in one CLI write', async () => {
    command.mockReturnValue(processOutput(''));
    expect(
      await enableClusterAddon({ ...options, addon: ['azure-monitor-metrics', 'keda'] })
    ).toEqual({ success: true });
    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining(['--enable-azure-monitor-metrics', '--enable-keda', '--no-wait']),
      expect.anything()
    );
  });

  test('rejects an empty addon selection', async () => {
    expect(await enableClusterAddon({ ...options, addon: [] })).toMatchObject({
      success: false,
      error: expect.stringContaining('No addons specified'),
    });
    expect(command).not.toHaveBeenCalled();
  });
});
