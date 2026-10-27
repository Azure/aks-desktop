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
import { getClusterCount } from '../azure/az-resource-graph';

const options = {
  subscriptionId: 'test-sub-123',
  resourceGroup: 'test-rg',
  clusterName: 'test-cluster',
};
const subscriptionId = '12345678-1234-1234-1234-123456789abc';

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

describe('getClusterCount', () => {
  test.each([{ Count: 5 }, { count_: 3 }, { Count: 0 }])('reads %j', async row => {
    command.mockReturnValue(processOutput(JSON.stringify({ data: [row] })));
    expect(await getClusterCount(subscriptionId)).toBe('Count' in row ? row.Count : row.count_);
  });
  test.each(['not-a-guid', ''])('rejects invalid subscriptions: %s', async id => {
    expect(await getClusterCount(id)).toBe(-1);
    expect(command).not.toHaveBeenCalled();
  });
  test.each([
    ['', 'ERROR: Resource graph query failed'],
    ['{"data":[]}', ''],
    ['not valid json', ''],
  ])('retains indeterminate results for invalid output', async (stdout, stderr) => {
    command.mockReturnValue(processOutput(stdout, stderr));
    expect(await getClusterCount(subscriptionId)).toBe(-1);
  });
});
