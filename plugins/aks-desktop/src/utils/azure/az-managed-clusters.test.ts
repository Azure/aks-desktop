// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), command: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));

import { getAksClusterStatus, getClusterCapabilities } from './az-clusters';
import { getAksOidcIssuerUrl } from './az-federation';
import { getKubeletIdentityObjectId } from './az-identity';
import { getManagedClusterDetails } from './az-managed-clusters';

const objectId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const options = {
  subscriptionId: '11111111-2222-3333-4444-555555555555',
  resourceGroup: 'rg',
  clusterName: 'aks',
  tenantId: 'selected-tenant',
  credential: {
    getToken: vi.fn(async () => ({
      token: 'test-token',
      expiresOnTimestamp: Date.now() + 3600_000,
    })),
  },
};
const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers });
const cluster = () => ({
  type: 'Microsoft.ContainerService/managedClusters',
  location: 'eastus2',
  sku: { name: 'Base', tier: 'Standard' },
  properties: {
    provisioningState: 'Succeeded',
    powerState: { code: 'Running' },
    kubernetesVersion: '1.33.0',
    status: { provisioningError: { code: 'Diagnostic', message: 'preserved' } },
    aadProfile: { enableAzureRBAC: true },
    networkProfile: { networkPolicy: 'cilium', networkPlugin: 'azure' },
    addonProfiles: { omsagent: { enabled: true } },
    azureMonitorProfile: { metrics: { enabled: true } },
    workloadAutoScalerProfile: {
      keda: { enabled: true },
      verticalPodAutoscaler: { enabled: true },
    },
    identityProfile: { kubeletidentity: { objectId } },
    oidcIssuerProfile: { issuerURL: 'https://issuer.example/' },
    securityProfile: { workloadIdentity: { enabled: true } },
  },
});
beforeEach(() => {
  mocks.fetch.mockReset().mockImplementation(() => Promise.resolve(json(cluster())));
  options.credential.getToken.mockClear();
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  expect(mocks.command).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('shared AKS REST detail projections', () => {
  test('preserves the ARM shape, top-level SKU and nested status', async () => {
    expect(await getManagedClusterDetails(options)).toEqual(cluster());
    expect(String(mocks.fetch.mock.calls[0][0])).toBe(
      `https://management.azure.com/subscriptions/${options.subscriptionId}/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/aks?api-version=2026-01-01`
    );
    expect(mocks.fetch.mock.calls[0][1].method).toBe('GET');
    expect(options.credential.getToken).toHaveBeenCalledWith(
      'https://management.azure.com/.default',
      expect.objectContaining({ tenantId: 'selected-tenant' })
    );
  });

  test('projects every capability from ARM nesting without JMESPath', async () => {
    expect(await getClusterCapabilities(options)).toEqual({
      sku: 'Base',
      tier: 'Standard',
      location: 'eastus2',
      kubernetesVersion: '1.33.0',
      aadEnabled: true,
      azureRbacEnabled: true,
      networkPolicy: 'cilium',
      networkPlugin: 'azure',
      prometheusEnabled: true,
      containerInsightsEnabled: true,
      kedaEnabled: true,
      vpaEnabled: true,
    });
  });

  test('preserves false values and defaults missing/null profiles', async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({
        properties: {
          aadProfile: { enableAzureRBAC: false },
          azureMonitorProfile: { metrics: { enabled: false } },
          addonProfiles: { omsagent: { enabled: false } },
          workloadAutoScalerProfile: {
            keda: { enabled: false },
            verticalPodAutoscaler: { enabled: false },
          },
        },
      })
    );
    expect(await getClusterCapabilities(options)).toEqual({
      sku: null,
      tier: null,
      location: null,
      kubernetesVersion: null,
      aadEnabled: true,
      azureRbacEnabled: false,
      networkPolicy: 'none',
      networkPlugin: null,
      prometheusEnabled: false,
      containerInsightsEnabled: false,
      kedaEnabled: false,
      vpaEnabled: false,
    });
    mocks.fetch.mockResolvedValueOnce(json({ properties: { aadProfile: null } }));
    expect(await getClusterCapabilities(options)).toMatchObject({
      aadEnabled: false,
      azureRbacEnabled: null,
      prometheusEnabled: null,
      containerInsightsEnabled: null,
      kedaEnabled: null,
      vpaEnabled: null,
    });
  });

  test.each([
    ['Succeeded', 'Running', true],
    ['Creating', 'Running', false],
    ['Failed', 'Running', false],
    ['Succeeded', 'Stopped', false],
    ['Succeeded', undefined, false],
    [undefined, 'Running', false],
  ])('requires Succeeded and Running for readiness', async (provisioningState, code, ready) => {
    mocks.fetch.mockResolvedValueOnce(
      json({ properties: { provisioningState, powerState: { code } } })
    );
    expect(await getAksClusterStatus(options)).toEqual({
      provisioningState: provisioningState || 'Unknown',
      powerState: code || 'Unknown',
      kubernetesVersion: 'Unknown',
      ready,
    });
  });

  test('reads and validates the kubelet object ID, not the control-plane identity', async () => {
    expect(await getKubeletIdentityObjectId(options)).toEqual({ success: true, objectId });
  });

  test('reads issuerURL with ARM casing and checks workload identity', async () => {
    expect(await getAksOidcIssuerUrl(options)).toEqual({
      success: true,
      issuerUrl: 'https://issuer.example/',
    });
  });

  test.each([
    [undefined, false, 'OIDC issuer or workload identity'],
    [undefined, true, 'OIDC issuer enabled'],
    ['https://issuer.example/', false, 'workload identity enabled'],
  ])('preserves distinct OIDC/workload-identity failures', async (issuerURL, enabled, message) => {
    mocks.fetch.mockResolvedValueOnce(
      json({
        properties: {
          oidcIssuerProfile: { issuerURL },
          securityProfile: { workloadIdentity: { enabled } },
        },
      })
    );
    expect(await getAksOidcIssuerUrl(options)).toMatchObject({
      success: false,
      error: expect.stringContaining(message),
    });
  });

  test('rejects Arc before making a managed-cluster request', async () => {
    await expect(getManagedClusterDetails({ ...options, clusterType: 'aksarc' })).rejects.toThrow(
      'Arc'
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('encodes path segments and supports a selected sovereign cloud', async () => {
    await getManagedClusterDetails({
      ...options,
      resourceGroup: 'rg/a',
      endpoint: 'https://management.usgovcloudapi.net',
    });
    expect(String(mocks.fetch.mock.calls[0][0])).toContain(
      'management.usgovcloudapi.net/subscriptions/'
    );
    expect(String(mocks.fetch.mock.calls[0][0])).toContain('/resourceGroups/rg%2Fa/');
  });

  test.each([401, 403, 404])('surfaces HTTP %i with ARM diagnostics', async status => {
    mocks.fetch.mockImplementation(() =>
      Promise.resolve(
        json({ error: { code: 'Failure', message: 'details' } }, status, {
          'x-ms-request-id': 'request-id',
        })
      )
    );
    await expect(getClusterCapabilities(options)).rejects.toMatchObject({
      status,
      code: 'Failure',
      requestId: 'request-id',
    });
    await expect(getAksClusterStatus(options)).rejects.toMatchObject({ status });
    expect(await getKubeletIdentityObjectId(options)).toMatchObject({
      success: false,
      error: expect.stringContaining('Failure'),
    });
    expect(await getAksOidcIssuerUrl(options)).toMatchObject({
      success: false,
      error: expect.stringContaining('Failure'),
    });
  });

  test.each([{}, { properties: null }, { properties: [] }])(
    'rejects malformed responses %j',
    async body => {
      mocks.fetch.mockResolvedValueOnce(json(body));
      await expect(getManagedClusterDetails(options)).rejects.toThrow('Malformed');
    }
  );

  test('retries throttled reads through the shared transport', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json({}, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(json(cluster()));
    expect((await getAksClusterStatus(options)).ready).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('honors cancellation before requesting a resource', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(
      getManagedClusterDetails({ ...options, signal: controller.signal })
    ).rejects.toThrow('cancelled');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
