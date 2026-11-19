// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Tests for getPrometheusEndpoint ARM REST discovery and error messages.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AzureRequestError } from '../../utils/azure/az-http';

const mocks = vi.hoisted(() => ({
  azListAll: vi.fn(),
  azRequest: vi.fn(),
  getAzureCloudEndpoints: vi.fn(),
  getSubscriptionCredential: vi.fn(),
}));

vi.mock('../../utils/azure/az-http', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/azure/az-http')>()),
  azListAll: (...args: unknown[]) => mocks.azListAll(...args),
  azRequest: (...args: unknown[]) => mocks.azRequest(...args),
}));
vi.mock('../../utils/azure/az-cloud', () => ({
  getAzureCloudEndpoints: (...args: unknown[]) => mocks.getAzureCloudEndpoints(...args),
}));
vi.mock('../../utils/azure/az-token', () => ({
  getSubscriptionCredential: (...args: unknown[]) => mocks.getSubscriptionCredential(...args),
}));

import { getPrometheusEndpoint } from '../../utils/prometheus/getPrometheusEndpoint';

const subCredential = { getToken: vi.fn() };
const cloud = {
  endpoint: 'https://management.azure.com',
  scope: 'https://management.azure.com/.default',
};
const workspaceId =
  '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.Monitor/accounts/test-workspace';

describe('getPrometheusEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAzureCloudEndpoints.mockResolvedValue(cloud);
    mocks.getSubscriptionCredential.mockReturnValue(subCredential);
  });

  test('when rule groups list is empty, error message includes "Azure Monitor Metrics" and "az aks update" command', async () => {
    mocks.azListAll.mockResolvedValue([]);

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
      expect(message).toContain('docs/cluster-requirements.md');
    }
  });

  test('when no matching cluster is found in rule groups, error includes the cluster name and enablement instructions', async () => {
    mocks.azListAll.mockResolvedValue([
      {
        name: 'other-rule-group',
        properties: {
          clusterName: 'other-cluster',
          scopes: [workspaceId],
        },
      },
    ]);

    try {
      await getPrometheusEndpoint('test-rg', 'my-aks-cluster', 'test-sub');
      expect.unreachable('Should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('my-aks-cluster');
      expect(message).toContain('az aks update');
      expect(message).toContain('--enable-azure-monitor-metrics');
      expect(message).toContain('test-rg');
      expect(message).toContain('docs/cluster-requirements.md');
    }
  });

  test('successfully returns prometheus endpoint across multiple rule groups and scopes', async () => {
    mocks.azListAll.mockResolvedValue([
      {
        name: 'other-rule-group',
        properties: {
          clusterName: 'other-cluster',
          scopes: [
            '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.Monitor/accounts/other-ws',
          ],
        },
      },
      {
        name: 'test-rule-group',
        properties: {
          clusterName: 'test-cluster',
          scopes: ['invalid-scope', workspaceId],
        },
      },
    ]);
    mocks.azRequest.mockResolvedValue({
      properties: {
        metrics: {
          prometheusQueryEndpoint: 'https://prometheus.test.azure.com/',
        },
      },
    });

    const endpoint = await getPrometheusEndpoint('test-rg', 'test-cluster', 'test-sub');

    expect(endpoint).toBe('https://prometheus.test.azure.com');
    expect(mocks.azListAll).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.AlertsManagement/prometheusRuleGroups',
        apiVersion: '2023-03-01',
        credential: subCredential,
        endpoint: cloud.endpoint,
        scope: cloud.scope,
      })
    );
    const listSignal = mocks.azListAll.mock.calls[0]?.[0]?.signal;
    expect(listSignal).toBeDefined();
    expect(mocks.azRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: workspaceId,
        apiVersion: '2023-04-03',
        credential: subCredential,
        endpoint: cloud.endpoint,
        scope: cloud.scope,
        signal: listSignal,
      })
    );
  });

  test('uses the workspace subscription credential when workspace sits in another subscription', async () => {
    const crossSubWorkspace =
      '/subscriptions/other-sub/resourceGroups/ws-rg/providers/Microsoft.Monitor/accounts/ws';
    const otherCredential = { getToken: vi.fn() };
    mocks.getSubscriptionCredential.mockImplementation((sub: string) =>
      sub === 'other-sub' ? otherCredential : subCredential
    );
    mocks.azListAll.mockResolvedValue([
      {
        name: 'test-rule-group',
        properties: { clusterName: 'test-cluster', scopes: [crossSubWorkspace] },
      },
    ]);
    mocks.azRequest.mockResolvedValue({
      properties: { metrics: { prometheusQueryEndpoint: 'https://prom.example.com' } },
    });

    await expect(getPrometheusEndpoint('test-rg', 'test-cluster', 'test-sub')).resolves.toBe(
      'https://prom.example.com'
    );
    expect(mocks.azRequest).toHaveBeenCalledWith(
      expect.objectContaining({ credential: otherCredential })
    );
  });

  test('propagates ARM setup/auth errors and cancellation', async () => {
    mocks.azListAll.mockRejectedValueOnce(
      new AzureRequestError('AuthorizationFailed', { status: 403 })
    );
    await expect(getPrometheusEndpoint('test-rg', 'test-cluster', 'test-sub')).rejects.toThrow(
      'AuthorizationFailed'
    );

    mocks.azListAll.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      signal?.throwIfAborted();
      return Promise.resolve([]);
    });
    const controller = new AbortController();
    controller.abort(new Error('Aborted'));
    await expect(
      getPrometheusEndpoint('test-rg', 'test-cluster', 'test-sub', { signal: controller.signal })
    ).rejects.toThrow('Aborted');
  });

  test('rejects non-HTTPS endpoints and dot-segment inputs', async () => {
    await expect(getPrometheusEndpoint('..', 'test-cluster', 'test-sub')).rejects.toThrow(
      'Resource group, cluster name, and subscription are required'
    );

    mocks.azListAll.mockResolvedValue([
      {
        name: 'test-rule-group',
        properties: { clusterName: 'test-cluster', scopes: [workspaceId] },
      },
    ]);
    mocks.azRequest.mockResolvedValue({
      properties: { metrics: { prometheusQueryEndpoint: 'http://insecure.example.com' } },
    });
    await expect(getPrometheusEndpoint('test-rg', 'test-cluster', 'test-sub')).rejects.toThrow(
      'Prometheus query endpoint must use HTTPS'
    );
  });

  test('rejects missing workspace scopes, missing endpoint, and malformed endpoint URLs', async () => {
    mocks.azListAll.mockResolvedValueOnce([
      {
        name: 'test-rule-group',
        properties: {
          clusterName: 'test-cluster',
          scopes: [
            '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.ContainerService/managedClusters/test-cluster',
          ],
        },
      },
    ]);
    await expect(getPrometheusEndpoint('test-rg', 'test-cluster', 'test-sub')).rejects.toThrow(
      'Rule group has no valid Azure Monitor workspace scopes defined'
    );
    expect(mocks.azRequest).not.toHaveBeenCalled();

    mocks.azListAll.mockResolvedValue([
      {
        name: 'test-rule-group',
        properties: { clusterName: 'test-cluster', scopes: [workspaceId] },
      },
    ]);
    mocks.azRequest.mockResolvedValueOnce({ properties: { metrics: {} } });
    await expect(getPrometheusEndpoint('test-rg', 'test-cluster', 'test-sub')).rejects.toThrow(
      'Azure Monitor workspace is missing prometheusQueryEndpoint'
    );

    mocks.azRequest.mockResolvedValueOnce({
      properties: { metrics: { prometheusQueryEndpoint: 'not a valid url' } },
    });
    await expect(getPrometheusEndpoint('test-rg', 'test-cluster', 'test-sub')).rejects.toThrow(
      'Azure Monitor workspace returned an invalid endpoint URL'
    );
  });
});
