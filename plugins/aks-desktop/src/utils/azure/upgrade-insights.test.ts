// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_VERSION, Cluster, Insight } from '../../types/upgradeInsights';
import { AzureRequestError } from './az-http';
import {
  ArmProvider,
  clusterBase,
  createUpgradeInsightsProvider,
  getUpgradeInsightSubscriptions,
} from './upgrade-insights';

const mocks = vi.hoisted(() => ({ request: vi.fn(), subscriptions: vi.fn() }));
vi.mock('./az-http', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-http')>()),
  azRequest: mocks.request,
}));
vi.mock('./az-subscriptions', () => ({ getSubscriptions: mocks.subscriptions }));

const subscription = '00000000-0000-4000-8000-000000000001';
const secondSubscription = '00000000-0000-4000-8000-000000000002';
const tenant = '00000000-0000-4000-8000-000000000003';
const secondTenant = '00000000-0000-4000-8000-000000000004';
const cluster: Cluster = {
  id: `/subscriptions/${subscription}/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/test`,
  name: 'test',
  subscription,
  resourceGroup: 'rg',
  location: 'eastus',
  kubernetesVersion: '1.34.1',
  poolInventoryKnown: true,
  pools: [{ name: 'system', version: '1.34.1', nodeImageVersion: 'image-1' }],
};
const insight: Insight = {
  id: `${cluster.id}/upgradeInsights/server-name`,
  name: 'server-name',
  properties: {
    upgradeType: 'ControlPlane',
    provisioningState: 'Succeeded',
    targetKubernetesVersion: '1.34.2',
    currentKubernetesVersion: '1.34.1',
    lastEvaluatedAt: '2026-10-28T17:00:00Z',
    expiresAt: '2026-10-29T17:00:00Z',
    evaluation: { status: 'Passed', evaluatedAt: '2026-10-28T17:00:00Z' },
  },
};

beforeEach(() => {
  mocks.request.mockReset();
  mocks.subscriptions.mockReset();
});

describe('native Azure transport', () => {
  it('uses the existing subscription list and carries the correct tenant', async () => {
    mocks.subscriptions.mockResolvedValue([
      { id: subscription, name: 'Primary', tenant, status: 'Enabled' },
      { id: secondSubscription, name: 'Disabled', tenant: secondTenant, status: 'Disabled' },
    ]);
    expect(await getUpgradeInsightSubscriptions()).toEqual([
      { id: subscription, name: 'Primary', tenantId: tenant },
    ]);
    mocks.request.mockResolvedValue({ value: [] });
    const provider = createUpgradeInsightsProvider([
      { id: subscription, name: 'Primary', tenantId: tenant },
      { id: secondSubscription, name: 'Second', tenantId: secondTenant },
    ]);
    await provider.listInsights({
      ...cluster,
      id: cluster.id.replace(subscription, secondSubscription),
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', tenantId: secondTenant })
    );
    expect(mocks.request.mock.calls[0][0].url).toContain(secondSubscription);
  });

  it('surfaces subscription errors and malformed tenant metadata', async () => {
    mocks.subscriptions.mockRejectedValueOnce(new Error('Please sign in'));
    await expect(getUpgradeInsightSubscriptions()).rejects.toThrow('Please sign in');
    mocks.subscriptions.mockResolvedValue([{ id: subscription, name: 'Bad', status: 'Enabled' }]);
    await expect(getUpgradeInsightSubscriptions()).rejects.toThrow();
    expect(() =>
      createUpgradeInsightsProvider([{ id: subscription, name: 'Bad', tenantId: '' }])
    ).toThrow('tenant');
  });

  it('rejects access to an unselected subscription before authenticating', async () => {
    const provider = createUpgradeInsightsProvider([
      { id: subscription, name: 'Primary', tenantId: tenant },
    ]);
    await expect(
      provider.listInsights({
        ...cluster,
        id: cluster.id.replace(subscription, secondSubscription),
      })
    ).rejects.toThrow('selected subscription');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('passes cancellation through the native authenticated request', async () => {
    const controller = new AbortController();
    mocks.request.mockResolvedValue({ value: [] });
    await createUpgradeInsightsProvider([
      { id: subscription, name: 'Primary', tenantId: tenant },
    ]).listInsights(cluster, controller.signal);
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal, tenantId: tenant })
    );
  });
});

describe('Upgrade Insights ARM contract', () => {
  it('uses the preview API and follows same-subscription continuation pages', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        value: [insight],
        nextLink: `https://management.azure.com${cluster.id}/upgradeInsights?api-version=${API_VERSION}&$skiptoken=next`,
      })
      .mockResolvedValueOnce({ value: [insight] });
    expect(await new ArmProvider(transport, [subscription]).listInsights(cluster)).toHaveLength(2);
    expect(transport.mock.calls[0].slice(0, 2)).toEqual([
      `${cluster.id}/upgradeInsights?api-version=${API_VERSION}`,
      'GET',
    ]);
    expect(transport.mock.calls[1][0]).toContain('$skiptoken=next');
  });

  it.each([
    'https://untrusted.example/steal',
    `https://management.azure.com/subscriptions/${secondSubscription}/resources`,
    `http://management.azure.com${cluster.id}/upgradeInsights`,
  ])('rejects an untrusted pagination URL: %s', async nextLink => {
    const transport = vi.fn().mockResolvedValue({ value: [], nextLink });
    await expect(new ArmProvider(transport, [subscription]).listInsights(cluster)).rejects.toThrow(
      'Untrusted'
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('detects pagination loops rather than hanging', async () => {
    const transport = vi.fn().mockResolvedValue({
      value: [],
      nextLink: `${cluster.id}/upgradeInsights?api-version=${API_VERSION}`,
    });
    await expect(new ArmProvider(transport, [subscription]).listInsights(cluster)).rejects.toThrow(
      'pagination loop'
    );
  });

  it('preserves Azure diagnostics rather than substituting demo results', async () => {
    const error = new AzureRequestError('Preview not enabled', {
      status: 403,
      code: 'FeatureNotEnabled',
      requestId: 'request-1',
    });
    const provider = new ArmProvider(vi.fn().mockRejectedValue(error), [subscription]);
    await expect(provider.listInsights(cluster)).rejects.toBe(error);
  });

  it('does not make requests when already cancelled, even on a cache hit', async () => {
    const transport = vi.fn().mockResolvedValue({ value: [insight] });
    const provider = new ArmProvider(transport, [subscription]);
    await provider.listInsights(cluster);
    const controller = new AbortController();
    controller.abort();
    await expect(provider.listInsights(cluster, controller.signal)).rejects.toThrow('Aborted');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('clones cached records and bypasses them on explicit refresh', async () => {
    const transport = vi.fn().mockResolvedValue({ value: [insight] });
    const provider = new ArmProvider(transport, [subscription]);
    const first = await provider.listInsights(cluster);
    first[0].name = 'mutated';
    expect((await provider.listInsights(cluster))[0].name).toBe('server-name');
    expect(transport).toHaveBeenCalledTimes(1);
    await provider.listInsights(cluster, undefined, true);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('expires the cache after sixty seconds', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const transport = vi.fn().mockResolvedValue({ value: [insight] });
      const provider = new ArmProvider(transport, [subscription]);
      await provider.listInsights(cluster);
      now.mockReturnValue(61_001);
      await provider.listInsights(cluster);
      expect(transport).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it('accepts nullable pool inventory without claiming the pool inventory is complete', async () => {
    const transport = vi.fn(async (path: string) =>
      path.includes('/managedClusters?')
        ? {
            value: [
              {
                id: cluster.id,
                name: cluster.name,
                location: cluster.location,
                properties: { currentKubernetesVersion: '1.34.1', agentPoolProfiles: null },
              },
            ],
          }
        : { value: [] }
    );
    const result = await new ArmProvider(transport, [subscription]).listClusters();
    expect(result.clusters[0]).toMatchObject({
      kubernetesVersion: '1.34.1',
      poolInventoryKnown: false,
      pools: [],
    });
  });

  it('reports partial subscription failures and unknown Fleet coverage', async () => {
    const transport = vi.fn(async (path: string) => {
      if (path.includes(secondSubscription)) throw new Error('Second subscription forbidden');
      if (path.includes('/fleets?')) throw new Error('Fleet read denied');
      return {
        value: [{ id: cluster.id, name: cluster.name, location: cluster.location, properties: {} }],
      };
    });
    const result = await new ArmProvider(transport, [
      subscription,
      secondSubscription,
    ]).listClusters();
    expect(result.clusters).toHaveLength(1);
    expect(result.warnings[0]).toContain('Second subscription forbidden');
    expect(result.fleetWarnings.join(' ')).toContain('Fleet read denied');
    expect(result.clusters[0].fleetMembershipKnown).toBe(false);
  });

  it('surfaces all-inventory failure as an error', async () => {
    const provider = new ArmProvider(vi.fn().mockRejectedValue(new Error('Forbidden')), [
      subscription,
    ]);
    await expect(provider.listClusters()).rejects.toThrow('Forbidden');
  });

  it('associates optional Fleet membership without inventing standalone status', async () => {
    const fleet = {
      id: `/subscriptions/${subscription}/resourceGroups/rg/providers/Microsoft.ContainerService/fleets/team`,
      name: 'team',
    };
    const transport = vi.fn(async (path: string) => {
      if (path.includes('/managedClusters?')) {
        return {
          value: [
            { id: cluster.id, name: cluster.name, location: cluster.location, properties: {} },
          ],
        };
      }
      if (path.includes('/fleets?')) return { value: [fleet] };
      return { value: [{ properties: { clusterResourceId: cluster.id.toUpperCase() } }] };
    });
    const result = await new ArmProvider(transport, [subscription]).listClusters();
    expect(result.clusters[0].fleets).toEqual([fleet]);
    expect(result.clusters[0].fleetMembershipKnown).toBe(true);
  });

  it('uses dedicated pool targets and keeps scope caches separate', async () => {
    const transport = vi.fn(async (path: string) =>
      path.includes('/agentPools/')
        ? { properties: { upgrades: [{ kubernetesVersion: '1.35.2' }] } }
        : {
            properties: {
              controlPlaneProfile: {
                upgrades: [
                  { kubernetesVersion: '1.34.2' },
                  { kubernetesVersion: '1.34.10' },
                  { kubernetesVersion: '1.34.2' },
                ],
              },
              agentPoolProfiles: null,
            },
          }
    );
    const provider = new ArmProvider(transport, [subscription]);
    expect(await provider.listUpgradeTargets(cluster, { upgradeType: 'ControlPlane' })).toEqual([
      '1.34.2',
      '1.34.10',
    ]);
    expect(
      await provider.listUpgradeTargets(cluster, {
        upgradeType: 'AgentPool',
        agentPoolName: 'system',
      })
    ).toEqual(['1.35.2']);
    await provider.listUpgradeTargets(cluster, { upgradeType: 'ControlPlane' });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][0]).toContain('/agentPools/system/upgradeProfiles/default');
  });

  it('accepts null target arrays but rejects flattened responses', async () => {
    const transport = vi.fn().mockResolvedValue({
      properties: { controlPlaneProfile: { upgrades: null } },
    });
    const provider = new ArmProvider(transport, [subscription]);
    expect(await provider.listUpgradeTargets(cluster, { upgradeType: 'ControlPlane' })).toEqual([]);
    transport.mockResolvedValue({ controlPlaneProfile: { upgrades: [] } });
    await expect(
      provider.listUpgradeTargets(cluster, { upgradeType: 'ControlPlaneAndAgentPools' })
    ).rejects.toThrow();
  });

  it('rejects missing pool targets without falling back to control-plane targets', async () => {
    const transport = vi.fn();
    await expect(
      new ArmProvider(transport, [subscription]).listUpgradeTargets(cluster, {
        upgradeType: 'AgentPool',
        agentPoolName: 'missing',
      })
    ).rejects.toThrow('not present');
    expect(transport).not.toHaveBeenCalled();
  });

  it('verifies Generate with the exact returned ID and invalidates stored-list cache', async () => {
    const transport = vi.fn(async (_path: string, method: string) =>
      method === 'POST' ? insight : _path.includes('/upgradeInsights?') ? { value: [] } : insight
    );
    const provider = new ArmProvider(transport, [subscription]);
    await provider.listInsights(cluster);
    expect(
      await provider.generate(cluster, {
        upgradeType: 'ControlPlane',
        targetKubernetesVersion: '1.34.2',
      })
    ).toEqual(insight);
    expect(transport.mock.calls[2].slice(0, 2)).toEqual([
      `${insight.id}?api-version=${API_VERSION}`,
      'GET',
    ]);
    await provider.listInsights(cluster);
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it('rejects an unverified, missing, or foreign generated record', async () => {
    const request = { upgradeType: 'ControlPlane' as const, targetKubernetesVersion: '1.34.2' };
    for (const generated of [
      { ...insight, id: undefined },
      { ...insight, id: `${cluster.id}-other/upgradeInsights/server-name` },
    ]) {
      const transport = vi.fn().mockResolvedValue(generated);
      await expect(
        new ArmProvider(transport, [subscription]).generate(cluster, request)
      ).rejects.toThrow();
      expect(transport).toHaveBeenCalledTimes(1);
    }
    const transport = vi
      .fn()
      .mockResolvedValueOnce(insight)
      .mockResolvedValueOnce({
        ...insight,
        properties: { ...insight.properties, lastEvaluatedAt: '2026-10-27T17:00:00Z' },
      });
    await expect(
      new ArmProvider(transport, [subscription]).generate(cluster, request)
    ).rejects.toThrow('does not match');
  });

  it('does not mistake JSON object-key order for a stale Generate result', async () => {
    const generated = {
      ...insight,
      properties: { ...insight.properties, metadata: { b: 2, a: 1 } },
    };
    const verified = {
      ...insight,
      properties: { ...insight.properties, metadata: { a: 1, b: 2 } },
    };
    const transport = vi.fn().mockResolvedValueOnce(generated).mockResolvedValueOnce(verified);
    await expect(
      new ArmProvider(transport, [subscription]).generate(cluster, {
        upgradeType: 'ControlPlane',
        targetKubernetesVersion: '1.34.2',
      })
    ).resolves.toEqual(verified);
  });

  it('generates NodeImage insights without accessing Kubernetes upgrade profiles', async () => {
    const generated = {
      ...insight,
      properties: {
        ...insight.properties,
        upgradeType: 'NodeImage',
        agentPoolName: 'system',
        targetNodeImageVersion: 'image-2',
      },
    };
    const transport = vi.fn().mockResolvedValue(generated);
    await new ArmProvider(transport, [subscription]).generate(cluster, {
      upgradeType: 'NodeImage',
      agentPoolName: 'system',
    });

    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.map(call => call[0]).join(' ')).not.toContain('upgradeProfiles');
  });

  it('rejects a generated result for a different target before claiming success', async () => {
    const transport = vi.fn().mockResolvedValue(insight);
    await expect(
      new ArmProvider(transport, [subscription]).generate(cluster, {
        upgradeType: 'ControlPlane',
        targetKubernetesVersion: '1.35.1',
      })
    ).rejects.toThrow('different scope or target');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects an insight outside the selected cluster and invalid resource IDs', async () => {
    const transport = vi.fn();
    const provider = new ArmProvider(transport, [subscription]);
    for (const id of [
      `${cluster.id}-other/upgradeInsights/name`,
      `${cluster.id}/upgradeInsights/../other`,
      `${cluster.id}/upgradeInsights/%2e%2e`,
    ]) {
      await expect(provider.getInsight(cluster, id)).rejects.toThrow('selected AKS cluster');
    }
    expect(transport).not.toHaveBeenCalled();
    expect(() => clusterBase({ ...cluster, id: 'https://untrusted.example' })).toThrow();
  });
});
