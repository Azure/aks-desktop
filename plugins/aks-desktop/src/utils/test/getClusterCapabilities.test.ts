// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// REST capability projections are covered in az-managed-clusters.test.ts.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  enableClusterAddonsViaRest: vi.fn(),
}));
const command = mocks.command;
vi.stubGlobal('pluginRunCommand', command);
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ runCommand: command }));
vi.mock('../azure/az-cli-path', () => ({
  getAzCommand: () => 'az',
  getInstallationInstructions: () => 'Install Azure CLI',
}));
vi.mock('../azure/az-prometheus-provisioning', async importOriginal => ({
  ...(await importOriginal<typeof import('../azure/az-prometheus-provisioning')>()),
  enableClusterAddonsViaRest: (...args: unknown[]) => mocks.enableClusterAddonsViaRest(...args),
}));

import { enableClusterAddon } from '../azure/az-clusters';

const options = {
  subscriptionId: 'test-sub-123',
  resourceGroup: 'test-rg',
  clusterName: 'test-cluster',
};

beforeEach(() => {
  command.mockReset();
  mocks.enableClusterAddonsViaRest.mockReset();
});

describe('enableClusterAddon', () => {
  test.each(['azure-monitor-metrics', 'keda', 'vpa'] as const)(
    'delegates %s addon enablement to REST provisioning',
    async addon => {
      mocks.enableClusterAddonsViaRest.mockResolvedValue({ success: true });
      expect(await enableClusterAddon({ ...options, addon })).toEqual({ success: true });
      expect(mocks.enableClusterAddonsViaRest).toHaveBeenCalledWith({ ...options, addon });
      expect(command).not.toHaveBeenCalled();
    }
  );

  test('combines multiple addons in one REST call', async () => {
    mocks.enableClusterAddonsViaRest.mockResolvedValue({ success: true });
    expect(
      await enableClusterAddon({ ...options, addon: ['azure-monitor-metrics', 'keda'] })
    ).toEqual({ success: true });
    expect(mocks.enableClusterAddonsViaRest).toHaveBeenCalledTimes(1);
    expect(command).not.toHaveBeenCalled();
  });

  test('propagates REST failures and validation errors', async () => {
    mocks.enableClusterAddonsViaRest.mockResolvedValue({
      success: false,
      error: 'Authentication required. Please log in to Azure CLI.',
    });
    expect(await enableClusterAddon({ ...options, addon: 'keda' })).toEqual({
      success: false,
      error: 'Authentication required. Please log in to Azure CLI.',
    });
  });
});
