// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Tests for getPrometheusEndpoint error messages
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockResources = vi.fn();

vi.mock('@azure/arm-resourcegraph', () => ({
  ResourceGraphClient: class {
    resources = mockResources;
  },
}));

vi.mock('../../azureAuth', () => ({
  azureCredential: {},
}));

import { getPrometheusEndpoint } from '../../utils/prometheus/getPrometheusEndpoint';

const SUBSCRIPTION = '00000000-0000-0000-0000-000000000000';

describe('getPrometheusEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('when no rows are returned, error message includes "Azure Monitor Metrics" and "az aks update" command', async () => {
    mockResources.mockResolvedValue({ data: [] });

    try {
      await getPrometheusEndpoint('test-rg', 'test-cluster', SUBSCRIPTION);
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

  test('empty result error message references "docs/cluster-requirements.md"', async () => {
    mockResources.mockResolvedValue({ data: [] });

    await expect(getPrometheusEndpoint('test-rg', 'test-cluster', SUBSCRIPTION)).rejects.toThrow(
      'docs/cluster-requirements.md'
    );
  });

  test('successfully returns prometheus endpoint when everything is configured', async () => {
    mockResources.mockResolvedValue({
      data: [{ prometheusEndpoint: 'https://prometheus.test.azure.com' }],
    });

    const endpoint = await getPrometheusEndpoint('test-rg', 'test-cluster', SUBSCRIPTION);

    expect(endpoint).toBe('https://prometheus.test.azure.com');
  });

  test('throws on invalid subscription ID', async () => {
    await expect(getPrometheusEndpoint('test-rg', 'test-cluster', 'not-a-guid')).rejects.toThrow(
      'Invalid subscription ID format'
    );
  });
});
