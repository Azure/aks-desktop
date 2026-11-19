// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AzureRequestError } from './az-http';
import { AzTokenError } from './az-token';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getAzureCloudEndpoints: vi.fn(),
  getSubscriptionCredential: vi.fn(),
  registerResourceProvider: vi.fn(),
}));

vi.mock('./az-cloud', () => ({
  getAzureCloudEndpoints: (...args: unknown[]) => mocks.getAzureCloudEndpoints(...args),
}));
vi.mock('./az-token', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-token')>()),
  getSubscriptionCredential: (...args: unknown[]) => mocks.getSubscriptionCredential(...args),
}));
vi.mock('./az-resource-providers', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-resource-providers')>()),
  registerResourceProvider: (...args: unknown[]) => mocks.registerResourceProvider(...args),
}));

import { enableClusterAddonsViaRest } from './az-prometheus-provisioning';

const subscriptionId = '11111111-2222-3333-4444-555555555555';
const resourceGroup = 'cluster-rg';
const clusterName = 'my-aks';
const clusterId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${clusterName}`;
const amwRg = 'DefaultResourceGroup-eastus';
const amwName = 'DefaultAzureMonitorWorkspace-eastus';
const amwId = `/subscriptions/${subscriptionId}/resourceGroups/${amwRg}/providers/Microsoft.Monitor/accounts/${amwName}`;
const credential = {
  getToken: vi.fn(async () => ({ token: 'test-token', expiresOnTimestamp: 9e12 })),
};
const cloud = {
  endpoint: 'https://management.azure.com',
  scope: 'https://management.azure.com/.default',
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

function clusterBody(metricsEnabled = false) {
  return {
    id: clusterId,
    name: clusterName,
    type: 'Microsoft.ContainerService/managedClusters',
    location: 'eastus',
    sku: { name: 'Base', tier: 'Standard' },
    properties: {
      provisioningState: 'Succeeded',
      kubernetesVersion: '1.31.0',
      ...(metricsEnabled && {
        azureMonitorProfile: {
          metrics: {
            enabled: true,
            kubeStateMetrics: { metricLabelsAllowlist: '', metricAnnotationsAllowList: '' },
          },
        },
      }),
    },
  };
}

describe('enableClusterAddonsViaRest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAzureCloudEndpoints.mockResolvedValue(cloud);
    mocks.getSubscriptionCredential.mockReturnValue(credential);
    mocks.registerResourceProvider.mockResolvedValue({
      success: true,
      registrationState: 'Registered',
    });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('provisions default RG, AMW, DCE, DCR, DCRA, rule groups, and cluster PUT for new setup', async () => {
    const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const parsed = new URL(url);
      const method = init.method ?? 'GET';
      const body = init.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ method, path: parsed.pathname, body });

      if (method === 'GET' && parsed.pathname === clusterId) {
        return json(clusterBody(false));
      }
      if (method === 'GET' && parsed.pathname.endsWith('/providers')) {
        return json({
          value: [
            { namespace: 'Microsoft.Insights', registrationState: 'Registered' },
            { namespace: 'Microsoft.AlertsManagement', registrationState: 'Registered' },
          ],
        });
      }
      if (method === 'GET' && parsed.pathname.endsWith('/providers/Microsoft.Monitor')) {
        return json({
          resourceTypes: [{ resourceType: 'accounts', locations: ['East US', 'West US'] }],
        });
      }
      if (method === 'GET' && parsed.pathname.endsWith(`/resourceGroups/${amwRg}`)) {
        return json({ error: { code: 'ResourceGroupNotFound', message: 'Not found' } }, 404);
      }
      if (method === 'PUT' && parsed.pathname.endsWith(`/resourceGroups/${amwRg}`)) {
        return json({ id: `/subscriptions/${subscriptionId}/resourceGroups/${amwRg}` }, 201);
      }
      if (method === 'PUT' && parsed.pathname === amwId) {
        return json({ id: amwId, location: 'eastus', properties: {} }, 201);
      }
      if (method === 'GET' && parsed.pathname.endsWith('/alertRuleRecommendations')) {
        return json({
          value: [
            {
              name: 'NodeRecordingRulesRuleGroup',
              properties: {
                alertRuleType: 'Microsoft.AlertsManagement/prometheusRuleGroups',
                rulesArmTemplate: {
                  resources: [{ properties: { rules: [{ record: 'node:up', expression: 'up' }] } }],
                },
              },
            },
            {
              name: 'NodeRecordingRulesRuleGroup-Win',
              properties: {
                alertRuleType: 'Microsoft.AlertsManagement/prometheusRuleGroups',
                rulesArmTemplate: {
                  resources: [{ properties: { rules: [{ record: 'win:up', expression: 'up' }] } }],
                },
              },
            },
          ],
        });
      }
      if (method === 'PUT') {
        return json({ id: parsed.pathname, properties: {} }, 200);
      }
      return json({}, 200);
    });

    const result = await enableClusterAddonsViaRest({
      subscriptionId,
      resourceGroup,
      clusterName,
      addon: ['azure-monitor-metrics', 'keda'],
    });

    expect(result).toEqual({ success: true });
    expect(mocks.registerResourceProvider).toHaveBeenCalledTimes(1);
    expect(mocks.registerResourceProvider).toHaveBeenCalledWith(
      'Microsoft.Monitor',
      subscriptionId,
      expect.objectContaining({ waitUntilRegistered: true })
    );

    const putPaths = calls.filter(c => c.method === 'PUT').map(c => c.path);
    expect(putPaths).toContain(`/subscriptions/${subscriptionId}/resourceGroups/${amwRg}`);
    expect(putPaths).toContain(amwId);
    expect(putPaths.some(p => p.includes('/dataCollectionEndpoints/MSProm-eastus-my-aks'))).toBe(
      true
    );
    expect(putPaths.some(p => p.includes('/dataCollectionRules/MSProm-eastus-my-aks'))).toBe(true);
    expect(
      putPaths.some(p =>
        p.endsWith('/dataCollectionRuleAssociations/ContainerInsightsMetricsExtension')
      )
    ).toBe(true);
    expect(
      putPaths.some(p => p.endsWith('/prometheusRuleGroups/NodeRecordingRulesRuleGroup-my-aks'))
    ).toBe(true);

    const winRulePut = calls.find(
      c =>
        c.method === 'PUT' &&
        c.path.endsWith('/prometheusRuleGroups/NodeRecordingRulesRuleGroup-Win-my-aks')
    );
    expect((winRulePut?.body?.properties as { enabled: boolean }).enabled).toBe(false);

    const clusterPut = calls.find(c => c.method === 'PUT' && c.path === clusterId);
    expect(clusterPut?.body?.id).toBeUndefined();
    const props = clusterPut?.body?.properties as Record<string, unknown>;
    expect(props.provisioningState).toBeUndefined();
    expect(props.azureMonitorProfile).toEqual({
      metrics: {
        enabled: true,
        kubeStateMetrics: { metricLabelsAllowlist: '', metricAnnotationsAllowList: '' },
      },
    });
    expect(props.workloadAutoScalerProfile).toEqual({ keda: { enabled: true } });
  });

  test('reuses existing default RG and AMW without recreating them', async () => {
    const putPaths: string[] = [];
    mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const parsed = new URL(url);
      const method = init.method ?? 'GET';
      if (method === 'PUT') putPaths.push(parsed.pathname);
      if (method === 'GET' && parsed.pathname === clusterId) return json(clusterBody(false));
      if (method === 'GET' && parsed.pathname.endsWith('/providers')) {
        return json({
          value: [
            { namespace: 'Microsoft.Insights', registrationState: 'Registered' },
            { namespace: 'Microsoft.AlertsManagement', registrationState: 'Registered' },
            { namespace: 'Microsoft.Monitor', registrationState: 'Registered' },
          ],
        });
      }
      if (method === 'GET' && parsed.pathname.endsWith('/providers/Microsoft.Monitor')) {
        return json({ resourceTypes: [{ resourceType: 'accounts', locations: ['East US'] }] });
      }
      if (method === 'GET' && parsed.pathname.endsWith(`/resourceGroups/${amwRg}`)) {
        return json({ id: `/subscriptions/${subscriptionId}/resourceGroups/${amwRg}` });
      }
      if (method === 'GET' && parsed.pathname === amwId) {
        return json({ id: amwId, location: 'eastus', properties: {} });
      }
      if (method === 'GET' && parsed.pathname.endsWith('/alertRuleRecommendations')) {
        return json({ value: [] });
      }
      return json({ id: parsed.pathname }, 200);
    });

    await expect(
      enableClusterAddonsViaRest({
        subscriptionId,
        resourceGroup,
        clusterName,
        addon: 'azure-monitor-metrics',
      })
    ).resolves.toEqual({ success: true });

    expect(putPaths).not.toContain(`/subscriptions/${subscriptionId}/resourceGroups/${amwRg}`);
    expect(putPaths).not.toContain(amwId);
    expect(putPaths).toContain(clusterId);
  });

  test('skips artifact provisioning when metrics are already enabled', async () => {
    mocks.fetch.mockResolvedValueOnce(json(clusterBody(true)));

    await expect(
      enableClusterAddonsViaRest({
        subscriptionId,
        resourceGroup,
        clusterName,
        addon: 'azure-monitor-metrics',
      })
    ).resolves.toEqual({ success: true });
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  test('reports authentication, authorization, and partial failures cleanly for safe retry', async () => {
    mocks.getSubscriptionCredential.mockReturnValueOnce({
      getToken: async () => {
        throw new AzTokenError('Please run az login', true);
      },
    });
    await expect(
      enableClusterAddonsViaRest({
        subscriptionId,
        resourceGroup,
        clusterName,
        addon: 'keda',
      })
    ).resolves.toEqual({
      success: false,
      error: 'Authentication required. Please log in to Azure CLI.',
    });

    mocks.fetch.mockResolvedValueOnce(
      json({ error: { code: 'AuthorizationFailed', message: 'Denied' } }, 403)
    );
    await expect(
      enableClusterAddonsViaRest({
        subscriptionId,
        resourceGroup,
        clusterName,
        addon: 'azure-monitor-metrics',
      })
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Denied'),
    });

    // Partial failure: RG/AMW/DCE succeed, DCR PUT fails before cluster PUT; retry reuses RG/AMW and succeeds
    let rgCreated = false;
    let amwCreated = false;
    let dcrAttempts = 0;
    let clusterPutCount = 0;
    let amwPutCountOnRetry = 0;
    let rgPutCountOnRetry = 0;
    let inRetry = false;

    mocks.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const method = init?.method ?? 'GET';
      if (url.pathname.endsWith(`/managedClusters/${clusterName}`)) {
        if (method === 'PUT') {
          clusterPutCount += 1;
          return json({});
        }
        return json(clusterBody(false));
      }
      if (url.pathname.endsWith('/providers')) {
        return json({
          value: [
            { namespace: 'Microsoft.Insights', registrationState: 'Registered' },
            { namespace: 'Microsoft.AlertsManagement', registrationState: 'Registered' },
            { namespace: 'Microsoft.Monitor', registrationState: 'Registered' },
          ],
        });
      }
      if (url.pathname.endsWith('/providers/Microsoft.Monitor')) {
        return json({
          resourceTypes: [{ resourceType: 'accounts', locations: ['East US'] }],
        });
      }
      if (url.pathname.endsWith(`/resourceGroups/${amwRg}`)) {
        if (method === 'PUT') {
          if (inRetry) rgPutCountOnRetry += 1;
          rgCreated = true;
          return json({ id: `/subscriptions/${subscriptionId}/resourceGroups/${amwRg}` }, 201);
        }
        return rgCreated
          ? json({ id: `/subscriptions/${subscriptionId}/resourceGroups/${amwRg}` })
          : json({ error: { code: 'ResourceGroupNotFound' } }, 404);
      }
      if (url.pathname.toLowerCase().endsWith(`/accounts/${amwName.toLowerCase()}`)) {
        if (method === 'PUT') {
          if (inRetry) amwPutCountOnRetry += 1;
          amwCreated = true;
          return json({ id: amwId, location: 'eastus' }, 201);
        }
        return amwCreated
          ? json({ id: amwId, location: 'eastus', properties: { provisioningState: 'Succeeded' } })
          : json({ error: { code: 'ResourceNotFound' } }, 404);
      }
      if (url.pathname.includes('/dataCollectionRules/') && method === 'PUT') {
        dcrAttempts += 1;
        if (dcrAttempts === 1) {
          return json({ error: { code: 'Conflict', message: 'Transient DCR failure' } }, 409);
        }
        return json({ id: '/dcr/1' });
      }
      if (url.pathname.includes('/alertRuleRecommendations')) {
        return json({ value: [] });
      }
      return json({});
    });

    await expect(
      enableClusterAddonsViaRest({
        subscriptionId,
        resourceGroup,
        clusterName,
        addon: 'azure-monitor-metrics',
      })
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Transient DCR failure'),
    });
    expect(clusterPutCount).toBe(0);

    inRetry = true;
    await expect(
      enableClusterAddonsViaRest({
        subscriptionId,
        resourceGroup,
        clusterName,
        addon: 'azure-monitor-metrics',
      })
    ).resolves.toEqual({ success: true });
    expect(rgPutCountOnRetry).toBe(0);
    expect(amwPutCountOnRetry).toBe(0);
    expect(clusterPutCount).toBe(1);
  });

  test('validates addon list and coordinates before HTTP', async () => {
    await expect(
      enableClusterAddonsViaRest({ subscriptionId, resourceGroup, clusterName, addon: [] })
    ).resolves.toEqual({ success: false, error: 'No addons specified' });

    await expect(
      enableClusterAddonsViaRest({
        subscriptionId: 'invalid',
        resourceGroup,
        clusterName,
        addon: 'keda',
      })
    ).resolves.toEqual({ success: false, error: 'Invalid subscription ID format' });

    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('surfaces cancellation without issuing further writes', async () => {
    const controller = new AbortController();
    controller.abort(new AzureRequestError('Cancelled'));

    await expect(
      enableClusterAddonsViaRest({
        subscriptionId,
        resourceGroup,
        clusterName,
        addon: 'azure-monitor-metrics',
        signal: controller.signal,
      })
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Cancelled'),
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('accepts resource groups with periods and parentheses and strips read-only cluster fields', async () => {
    const customRg = 'prod.aks(legacy)';
    let putBody: Record<string, unknown> | undefined;

    mocks.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (init?.method === 'PUT' && url.pathname.endsWith(`/managedClusters/${clusterName}`)) {
        putBody = JSON.parse(String(init.body));
        return json({});
      }
      return json({
        id: `/subscriptions/${subscriptionId}/resourceGroups/${customRg}/providers/Microsoft.ContainerService/managedClusters/${clusterName}`,
        name: clusterName,
        type: 'Microsoft.ContainerService/managedClusters',
        eTag: 'etag-1',
        location: 'eastus',
        systemData: { createdBy: 'user' },
        tags: { env: 'prod' },
        properties: {
          provisioningState: 'Succeeded',
          powerState: { code: 'Running' },
          fqdn: 'aks.example.azmk8s.io',
          currentKubernetesVersion: '1.31.1',
          agentPoolProfiles: [
            {
              name: 'system',
              count: 3,
              vmSize: 'Standard_DS2_v2',
              provisioningState: 'Succeeded',
              powerState: { code: 'Running' },
              nodeImageVersion: 'AKSUbuntu-2204',
            },
          ],
        },
      });
    });

    const result = await enableClusterAddonsViaRest({
      subscriptionId,
      resourceGroup: customRg,
      clusterName,
      addon: 'keda',
    });

    expect(result).toEqual({ success: true });
    expect(putBody).toMatchObject({
      location: 'eastus',
      eTag: 'etag-1',
      tags: { env: 'prod' },
      properties: {
        workloadAutoScalerProfile: { keda: { enabled: true } },
        agentPoolProfiles: [{ name: 'system', count: 3, vmSize: 'Standard_DS2_v2' }],
      },
    });
    expect(putBody).not.toHaveProperty('id');
    expect(putBody?.properties).not.toHaveProperty('powerState');
    expect(putBody?.properties).not.toHaveProperty('fqdn');
    expect((putBody?.properties as any)?.agentPoolProfiles?.[0]).not.toHaveProperty(
      'nodeImageVersion'
    );
  });

  test('polls HTTP 200 azure-asyncoperation with credential-only override and Location resource state', async () => {
    const customCred = {
      getToken: vi.fn(async () => ({ token: 'tok', expiresOnTimestamp: 9e12 })),
    };
    let pollCalls = 0;
    let amwCreated = false;
    let amwPollCount = 0;
    const dceClusterUrl = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${clusterName}`;
    const calls: string[] = [];

    mocks.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (url.pathname.endsWith(`/managedClusters/${clusterName}`)) {
        return json({ id: dceClusterUrl, location: 'eastus', properties: {} });
      }
      if (url.pathname.endsWith('/providers')) {
        return json({
          value: [
            { namespace: 'Microsoft.Insights', registrationState: 'Registered' },
            { namespace: 'Microsoft.AlertsManagement', registrationState: 'Registered' },
            { namespace: 'Microsoft.Monitor', registrationState: 'Registered' },
          ],
        });
      }
      if (url.pathname.endsWith('/providers/Microsoft.Monitor')) {
        return json({
          resourceTypes: [{ resourceType: 'accounts', locations: ['East US'] }],
        });
      }
      if (url.pathname.includes('/alertRuleRecommendations')) {
        return json({ value: [] });
      }
      if (url.pathname.toLowerCase().endsWith(`/accounts/${amwName.toLowerCase()}`)) {
        if (init?.method === 'PUT') {
          amwCreated = true;
          return json(
            { id: amwId, location: 'eastus', properties: { provisioningState: 'Creating' } },
            201
          );
        }
        if (!amwCreated) {
          return json({ error: { code: 'ResourceNotFound' } }, 404);
        }
        amwPollCount += 1;
        return json({
          id: amwId,
          location: 'eastus',
          properties: { provisioningState: 'Succeeded' },
        });
      }
      if (url.pathname.includes('/dataCollectionEndpoints/') && init?.method === 'PUT') {
        return json({}, 200, {
          'azure-asyncoperation': `/subscriptions/${subscriptionId}/operations/op-1`,
        });
      }
      if (url.pathname.endsWith('/operations/op-1')) {
        pollCalls += 1;
        return json(
          pollCalls === 1
            ? { properties: { provisioningState: 'Creating' } }
            : { properties: { provisioningState: 'Succeeded' } }
        );
      }
      if (url.pathname.includes('/dataCollectionRules/') && init?.method === 'PUT') {
        return json({ id: '/dcr/1' });
      }
      return json({});
    });

    const result = await enableClusterAddonsViaRest({
      subscriptionId,
      resourceGroup,
      clusterName,
      addon: 'azure-monitor-metrics',
      credential: customCred as any,
    });

    expect(result).toEqual({ success: true });
    expect(amwCreated).toBe(true);
    expect(amwPollCount).toBe(1);
    expect(pollCalls).toBe(2);
    expect(calls.filter(c => c.endsWith(`/managedClusters/${clusterName}`))).toHaveLength(3);
  });

  test('retries cluster PUT once on 412 PreconditionFailed with fresh cluster state', async () => {
    let getCount = 0;
    let putCount = 0;

    mocks.fetch.mockImplementation(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putCount += 1;
        if (putCount === 1) {
          return json({ error: { code: 'PreconditionFailed', message: 'ETag mismatch' } }, 412);
        }
        return json({});
      }
      getCount += 1;
      return json({
        id: `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${clusterName}`,
        location: 'eastus',
        eTag: `etag-${getCount}`,
        tags: { rev: String(getCount) },
        properties: {},
      });
    });

    const result = await enableClusterAddonsViaRest({
      subscriptionId,
      resourceGroup,
      clusterName,
      addon: 'vpa',
    });

    expect(result).toEqual({ success: true });
    expect(getCount).toBe(2);
    expect(putCount).toBe(2);
  });

  test('accepts Unicode resource group names and polls/rejects reused AMW provisioning states', async () => {
    const unicodeRg = 'équipe-生产环境';
    let amwGetCount = 0;
    let dcrEndpointId: string | undefined;
    let dcraRuleId: string | undefined;

    mocks.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname.endsWith(`/managedClusters/${clusterName}`)) {
        return json({ id: clusterId, location: 'eastus', properties: {} });
      }
      if (url.pathname.endsWith('/providers')) {
        return json({
          value: [
            { namespace: 'Microsoft.Insights', registrationState: 'Registered' },
            { namespace: 'Microsoft.AlertsManagement', registrationState: 'Registered' },
            { namespace: 'Microsoft.Monitor', registrationState: 'Registered' },
          ],
        });
      }
      if (url.pathname.endsWith('/providers/Microsoft.Monitor')) {
        return json({
          resourceTypes: [{ resourceType: 'accounts', locations: ['East US'] }],
        });
      }
      if (url.pathname.endsWith(`/resourceGroups/${amwRg}`)) {
        return json({ id: `/subscriptions/${subscriptionId}/resourceGroups/${amwRg}` });
      }
      if (url.pathname.includes('/alertRuleRecommendations')) {
        return json({ value: [] });
      }
      if (url.pathname.includes('/dataCollectionRules/') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        dcrEndpointId = body?.properties?.dataCollectionEndpointId;
        return json({ id: '/dcr/1' });
      }
      if (url.pathname.includes('/dataCollectionRuleAssociations/') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        dcraRuleId = body?.properties?.dataCollectionRuleId;
        return json({});
      }
      if (
        url.pathname.toLowerCase().includes('/microsoft.monitor/accounts') &&
        (!init?.method || init.method === 'GET')
      ) {
        amwGetCount += 1;
        return json({
          id: amwId,
          location: 'eastus',
          properties: { provisioningState: amwGetCount === 1 ? 'Creating' : 'Succeeded' },
        });
      }
      return json({});
    });

    const ok = await enableClusterAddonsViaRest({
      subscriptionId,
      resourceGroup: unicodeRg,
      clusterName,
      addon: 'azure-monitor-metrics',
    });
    expect(ok).toEqual({ success: true });
    expect(amwGetCount).toBe(2);
    expect(dcrEndpointId).toBe(
      `/subscriptions/${subscriptionId}/resourceGroups/${unicodeRg}/providers/Microsoft.Insights/dataCollectionEndpoints/MSProm-eastus-${clusterName}`
    );
    expect(dcraRuleId).toBe(
      `/subscriptions/${subscriptionId}/resourceGroups/${unicodeRg}/providers/Microsoft.Insights/dataCollectionRules/MSProm-eastus-${clusterName}`
    );

    // Reusing a workspace in Failed state surfaces the failure before dependent writes
    mocks.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname.endsWith(`/managedClusters/${clusterName}`)) {
        return json({ id: clusterId, location: 'eastus', properties: {} });
      }
      if (url.pathname.endsWith('/providers')) {
        return json({
          value: [
            { namespace: 'Microsoft.Insights', registrationState: 'Registered' },
            { namespace: 'Microsoft.AlertsManagement', registrationState: 'Registered' },
            { namespace: 'Microsoft.Monitor', registrationState: 'Registered' },
          ],
        });
      }
      if (url.pathname.endsWith('/providers/Microsoft.Monitor')) {
        return json({
          resourceTypes: [{ resourceType: 'accounts', locations: ['East US'] }],
        });
      }
      if (url.pathname.endsWith(`/resourceGroups/${amwRg}`)) {
        return json({ id: `/subscriptions/${subscriptionId}/resourceGroups/${amwRg}` });
      }
      if (
        url.pathname.toLowerCase().includes('/microsoft.monitor/accounts') &&
        (!init?.method || init.method === 'GET')
      ) {
        return json({
          id: amwId,
          location: 'eastus',
          properties: { provisioningState: 'Failed', error: { message: 'AMW quota exceeded' } },
        });
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });

    const failed = await enableClusterAddonsViaRest({
      subscriptionId,
      resourceGroup: '生产环境',
      clusterName,
      addon: 'azure-monitor-metrics',
    });
    expect(failed).toEqual({
      success: false,
      error: expect.stringContaining('AMW quota exceeded'),
    });
  });

  test('retains workspace amwId when AMW creation completes via Azure-AsyncOperation with its own operation id', async () => {
    let dcrBody: Record<string, unknown> | undefined;
    let recommendationsUrl = '';

    mocks.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname.endsWith(`/managedClusters/${clusterName}`)) {
        return json({ id: clusterId, location: 'eastus', properties: {} });
      }
      if (url.pathname.endsWith('/providers')) {
        return json({
          value: [
            { namespace: 'Microsoft.Insights', registrationState: 'Registered' },
            { namespace: 'Microsoft.AlertsManagement', registrationState: 'Registered' },
            { namespace: 'Microsoft.Monitor', registrationState: 'Registered' },
          ],
        });
      }
      if (url.pathname.endsWith('/providers/Microsoft.Monitor')) {
        return json({
          resourceTypes: [{ resourceType: 'accounts', locations: ['East US'] }],
        });
      }
      if (
        url.pathname.endsWith(`/resourceGroups/${amwRg}`) &&
        (!init?.method || init.method === 'GET')
      ) {
        return json({ error: { code: 'ResourceGroupNotFound' } }, 404);
      }
      if (url.pathname.toLowerCase().endsWith(`/accounts/${amwName.toLowerCase()}`)) {
        return json({}, 202, {
          'azure-asyncoperation': `${url.origin}/subscriptions/${subscriptionId}/operations/amw-op-1`,
        });
      }
      if (url.pathname.endsWith('/operations/amw-op-1')) {
        return json({
          id: `/subscriptions/${subscriptionId}/operations/amw-op-1`,
          status: 'Succeeded',
        });
      }
      if (url.pathname.includes('/dataCollectionRules/') && init?.method === 'PUT') {
        dcrBody = JSON.parse(String(init.body));
        return json({ id: '/dcr/1' });
      }
      if (url.pathname.includes('/alertRuleRecommendations')) {
        recommendationsUrl = url.pathname;
        return json({ value: [] });
      }
      return json({});
    });

    const result = await enableClusterAddonsViaRest({
      subscriptionId,
      resourceGroup,
      clusterName,
      addon: 'azure-monitor-metrics',
    });

    expect(result).toEqual({ success: true });
    expect(
      (dcrBody?.properties as any)?.destinations?.monitoringAccounts?.[0]?.accountResourceId
    ).toBe(amwId);
    expect(recommendationsUrl).toBe(
      `${amwId}/providers/microsoft.alertsManagement/alertRuleRecommendations`
    );
  });
});
