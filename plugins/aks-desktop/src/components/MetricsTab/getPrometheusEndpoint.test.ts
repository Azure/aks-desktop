// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Tests for getPrometheusEndpoint error messages
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock external dependencies
vi.mock('../../utils/kubernetes/cli-runner', () => ({
  runCommandWithOutput: vi.fn(),
}));

vi.mock('../../utils/azure/az-cli', () => ({
  configureAzureCliExtensions: vi.fn().mockResolvedValue({ success: true }),
}));

import { runCommandWithOutput } from '../../utils/kubernetes/cli-runner';
import { getPrometheusEndpoint } from './getPrometheusEndpoint';

const mockRunCommandWithOutput = vi.mocked(runCommandWithOutput);

describe('getPrometheusEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('when rule groups stdout is empty, error message includes "Azure Monitor Metrics" and "az aks update" command', async () => {
    mockRunCommandWithOutput.mockResolvedValue({
      stdout: '',
      stderr: '',
    });

    try {
      await getPrometheusEndpoint('test-rg', 'test-cluster', 'test-sub');
      expect.unreachable('Should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('Azure Monitor Metrics');
      expect(message).toContain('az aks update');
      expect(message).toContain('--enable-azure-monitor-metrics');
      expect(message).toContain('test-rg');
      expect(message).toContain('test-cluster');
    }
  });

  test('when no matching cluster is found in rule groups, error includes the cluster name and enablement instructions', async () => {
    const ruleGroups = [
      {
        name: 'other-rule-group',
        clusterName: 'other-cluster',
        scopes: [
          '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.Monitor/accounts/test-workspace',
        ],
      },
    ];

    mockRunCommandWithOutput.mockResolvedValue({
      stdout: JSON.stringify(ruleGroups),
      stderr: '',
    });

    try {
      await getPrometheusEndpoint('test-rg', 'my-aks-cluster', 'test-sub');
      expect.unreachable('Should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('my-aks-cluster');
      expect(message).toContain('az aks update');
      expect(message).toContain('--enable-azure-monitor-metrics');
      expect(message).toContain('test-rg');
    }
  });

  test('empty stdout error message references "docs/cluster-requirements.md"', async () => {
    mockRunCommandWithOutput.mockResolvedValue({
      stdout: '',
      stderr: '',
    });

    await expect(getPrometheusEndpoint('test-rg', 'test-cluster', 'test-sub')).rejects.toThrow(
      'docs/cluster-requirements.md'
    );
  });

  test('no matching cluster error message references "docs/cluster-requirements.md"', async () => {
    const ruleGroups = [
      {
        name: 'rule-group-1',
        clusterName: 'different-cluster',
        scopes: [
          '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.Monitor/accounts/workspace',
        ],
      },
    ];

    mockRunCommandWithOutput.mockResolvedValue({
      stdout: JSON.stringify(ruleGroups),
      stderr: '',
    });

    await expect(getPrometheusEndpoint('test-rg', 'my-cluster', 'test-sub')).rejects.toThrow(
      'docs/cluster-requirements.md'
    );
  });

  test('successfully returns prometheus endpoint when everything is configured', async () => {
    const ruleGroups = [
      {
        name: 'test-rule-group',
        clusterName: 'test-cluster',
        scopes: [
          '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.Monitor/accounts/test-workspace',
        ],
      },
    ];

    // First call: list rule groups
    mockRunCommandWithOutput.mockResolvedValueOnce({
      stdout: JSON.stringify(ruleGroups),
      stderr: '',
    });

    // Second call: get prometheus endpoint
    mockRunCommandWithOutput.mockResolvedValueOnce({
      stdout: 'https://prometheus.test.azure.com\n',
      stderr: '',
    });

    const endpoint = await getPrometheusEndpoint('test-rg', 'test-cluster', 'test-sub');

    expect(endpoint).toBe('https://prometheus.test.azure.com');
  });

  test('throws error when rule groups JSON is malformed', async () => {
    mockRunCommandWithOutput.mockResolvedValue({
      stdout: 'not valid json {{{',
      stderr: '',
    });

    await expect(getPrometheusEndpoint('test-rg', 'test-cluster', 'test-sub')).rejects.toThrow(
      'Failed to parse prometheus rule groups response'
    );
  });
});
