// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunCommandAsync = vi.fn();
vi.mock('./az-cli-core', () => ({
  runCommandAsync: (...args: unknown[]) => mockRunCommandAsync(...args),
  debugLog: vi.fn(),
  isAzError: (s: string) => s.includes('ERROR:'),
  needsRelogin: () => false,
}));

vi.mock('./az-resource-graph', () => ({
  getClustersViaGraph: vi.fn(),
  getClusterResourceGroupViaGraph: vi.fn(),
}));

vi.mock('./az-subscriptions', () => ({
  getSubscriptions: vi.fn(),
}));

import { getConnectedClusters } from './az-clusters';

describe('getConnectedClusters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return BareMetal clusters from az connectedk8s list', async () => {
    const clusters = [
      {
        name: 'arc-cluster-1',
        resourceGroup: 'rg-arc',
        location: 'eastus',
        kubernetesVersion: '1.28.0',
        provisioningState: 'Succeeded',
        connectivityStatus: 'Connected',
      },
      {
        name: 'arc-cluster-2',
        resourceGroup: 'rg-arc',
        location: 'westus',
        agentVersion: '1.27.0',
        connectivityStatus: 'Disconnected',
      },
    ];

    mockRunCommandAsync.mockResolvedValue({
      stdout: JSON.stringify(clusters),
      stderr: '',
    });

    const result = await getConnectedClusters('sub-1');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: 'arc-cluster-1',
      subscription: 'sub-1',
      resourceGroup: 'rg-arc',
      location: 'eastus',
      version: '1.28.0',
      status: 'Succeeded',
      powerState: 'Connected',
      nodeCount: 0,
      clusterType: 'aksarc',
    });
    expect(result[1].version).toBe('1.27.0');
    expect(result[1].clusterType).toBe('aksarc');
  });

  it('should return empty list when connectedk8s extension is not installed', async () => {
    mockRunCommandAsync.mockResolvedValue({
      stdout: '',
      stderr:
        "'connectedk8s' is not a recognized command. Try az extension add --name connectedk8s",
    });

    const result = await getConnectedClusters('sub-1');

    expect(result).toEqual([]);
  });

  it('should return empty list when stderr mentions unrecognized arguments', async () => {
    mockRunCommandAsync.mockResolvedValue({
      stdout: '',
      stderr: 'unrecognized arguments: connectedk8s',
    });

    const result = await getConnectedClusters('sub-1');

    expect(result).toEqual([]);
  });

  it('should throw on non-warning stderr errors', async () => {
    mockRunCommandAsync.mockResolvedValue({
      stdout: '',
      stderr: 'ERROR: Something went wrong',
    });

    await expect(getConnectedClusters('sub-1')).rejects.toThrow('ERROR: Something went wrong');
  });

  it('should return empty list when stdout is empty', async () => {
    mockRunCommandAsync.mockResolvedValue({
      stdout: '',
      stderr: '',
    });

    const result = await getConnectedClusters('sub-1');

    expect(result).toEqual([]);
  });

  it('should throw a descriptive error when stdout is invalid JSON', async () => {
    mockRunCommandAsync.mockResolvedValue({
      stdout: '{not-json',
      stderr: '',
    });

    await expect(getConnectedClusters('sub-1')).rejects.toThrow(
      'Failed to parse connectedk8s list response'
    );
  });

  it('should ignore warning-only stderr and process stdout normally', async () => {
    const clusters = [
      {
        name: 'arc-cluster',
        resourceGroup: 'rg',
        location: 'eastus',
        kubernetesVersion: '1.28.0',
        provisioningState: 'Succeeded',
        connectivityStatus: 'Connected',
      },
    ];

    mockRunCommandAsync.mockResolvedValue({
      stdout: JSON.stringify(clusters),
      stderr: 'WARNING: Some deprecation notice',
    });

    const result = await getConnectedClusters('sub-1');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('arc-cluster');
  });

  it('should default version and status when fields are missing', async () => {
    const clusters = [
      {
        name: 'bare-cluster',
        resourceGroup: 'rg',
        location: 'westus',
      },
    ];

    mockRunCommandAsync.mockResolvedValue({
      stdout: JSON.stringify(clusters),
      stderr: '',
    });

    const result = await getConnectedClusters('sub-1');

    expect(result[0].version).toBe('');
    expect(result[0].status).toBe('Unknown');
    expect(result[0].powerState).toBe('Unknown');
  });
});
