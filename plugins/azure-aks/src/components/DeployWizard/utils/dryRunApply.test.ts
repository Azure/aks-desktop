// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockClusterRequest = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({
  clusterRequest: mockClusterRequest,
}));

import {
  buildApiPath,
  buildResourcePath,
  clearDiscoveryCache,
  discoverResource,
  dryRunApply,
} from './dryRunApply';

function errorWithStatus(msg: string, status: number, useResponseProp = false) {
  const err = new Error(msg);
  if (useResponseProp) {
    (err as any).response = { status };
  } else {
    (err as any).status = status;
  }
  return err;
}

// Discovery responses for common API groups
const coreV1Discovery = {
  resources: [
    { name: 'configmaps', kind: 'ConfigMap', namespaced: true },
    { name: 'namespaces', kind: 'Namespace', namespaced: false },
    { name: 'nodes', kind: 'Node', namespaced: false },
    { name: 'pods', kind: 'Pod', namespaced: true },
    { name: 'services', kind: 'Service', namespaced: true },
  ],
};

const appsV1Discovery = {
  resources: [
    { name: 'deployments', kind: 'Deployment', namespaced: true },
    { name: 'daemonsets', kind: 'DaemonSet', namespaced: true },
    { name: 'statefulsets', kind: 'StatefulSet', namespaced: true },
  ],
};

const rbacDiscovery = {
  resources: [
    { name: 'clusterroles', kind: 'ClusterRole', namespaced: false },
    { name: 'clusterrolebindings', kind: 'ClusterRoleBinding', namespaced: false },
    { name: 'roles', kind: 'Role', namespaced: true },
    { name: 'rolebindings', kind: 'RoleBinding', namespaced: true },
  ],
};

const apiextensionsDiscovery = {
  resources: [
    { name: 'customresourcedefinitions', kind: 'CustomResourceDefinition', namespaced: false },
  ],
};

const admissionregDiscovery = {
  resources: [
    {
      name: 'validatingwebhookconfigurations',
      kind: 'ValidatingWebhookConfiguration',
      namespaced: false,
    },
    {
      name: 'mutatingwebhookconfigurations',
      kind: 'MutatingWebhookConfiguration',
      namespaced: false,
    },
  ],
};

function setupDiscoveryMock() {
  mockClusterRequest.mockImplementation((url: string, opts: any) => {
    if (opts?.method === 'GET') {
      const discoveryMap: Record<string, any> = {
        '/api/v1': coreV1Discovery,
        '/apis/apps/v1': appsV1Discovery,
        '/apis/rbac.authorization.k8s.io/v1': rbacDiscovery,
        '/apis/apiextensions.k8s.io/v1': apiextensionsDiscovery,
        '/apis/admissionregistration.k8s.io/v1': admissionregDiscovery,
      };
      const response = discoveryMap[url];
      if (response) {
        return Promise.resolve(response);
      }
      return Promise.reject(new Error(`Unknown discovery URL: ${url}`));
    }
    // Default: resolve for POST/PATCH
    return Promise.resolve({});
  });
}

describe('discoverResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDiscoveryCache();
  });

  test('discovers namespaced resource from core API', async () => {
    setupDiscoveryMock();
    const result = await discoverResource('v1', 'Service');
    expect(result).toEqual({ plural: 'services', namespaced: true });
    expect(mockClusterRequest).toHaveBeenCalledWith('/api/v1', {
      method: 'GET',
      cluster: undefined,
    });
  });

  test('discovers cluster-scoped resource', async () => {
    setupDiscoveryMock();
    const result = await discoverResource('v1', 'Namespace');
    expect(result).toEqual({ plural: 'namespaces', namespaced: false });
  });

  test('caches discovery results per API group', async () => {
    setupDiscoveryMock();
    await discoverResource('apps/v1', 'Deployment');
    await discoverResource('apps/v1', 'StatefulSet');
    // Only 1 discovery request for apps/v1
    const getCalls = mockClusterRequest.mock.calls.filter(
      ([, opts]: [string, any]) => opts?.method === 'GET'
    );
    expect(getCalls).toHaveLength(1);
  });

  test('throws for unknown kind in API group', async () => {
    setupDiscoveryMock();
    await expect(discoverResource('v1', 'UnknownKind')).rejects.toThrow(
      'Unknown resource kind "UnknownKind" in API group "v1"'
    );
  });

  test('prefers primary resource over subresources with same kind', async () => {
    mockClusterRequest.mockImplementation((url: string, opts: any) => {
      if (opts?.method === 'GET') {
        return Promise.resolve({
          resources: [
            { name: 'deployments/status', kind: 'Deployment', namespaced: true },
            { name: 'deployments/scale', kind: 'Scale', namespaced: true },
            { name: 'deployments', kind: 'Deployment', namespaced: true },
          ],
        });
      }
      return Promise.resolve({});
    });
    const result = await discoverResource('apps/v1', 'Deployment');
    expect(result).toEqual({ plural: 'deployments', namespaced: true });
  });

  test('uses separate cache entries per cluster', async () => {
    setupDiscoveryMock();
    await discoverResource('v1', 'Service', 'cluster-a');
    await discoverResource('v1', 'Service', 'cluster-b');
    const getCalls = mockClusterRequest.mock.calls.filter(
      ([, opts]: [string, any]) => opts?.method === 'GET'
    );
    expect(getCalls).toHaveLength(2);
    expect(getCalls[0][1].cluster).toBe('cluster-a');
    expect(getCalls[1][1].cluster).toBe('cluster-b');
  });
});

describe('buildApiPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDiscoveryCache();
    setupDiscoveryMock();
  });

  test('builds core API path for v1 resources', async () => {
    const path = await buildApiPath({
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'my-svc', namespace: 'test-ns' },
    });
    expect(path).toBe('/api/v1/namespaces/test-ns/services');
  });

  test('builds extended API path for apps/v1 resources', async () => {
    const path = await buildApiPath({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'my-deploy', namespace: 'test-ns' },
    });
    expect(path).toBe('/apis/apps/v1/namespaces/test-ns/deployments');
  });

  test('defaults namespace to "default" when not specified', async () => {
    const path = await buildApiPath({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'my-cm' },
    });
    expect(path).toBe('/api/v1/namespaces/default/configmaps');
  });

  test('builds cluster-scoped path for Namespace kind', async () => {
    const path = await buildApiPath({
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: 'my-ns' },
    });
    expect(path).toBe('/api/v1/namespaces');
  });

  test('builds cluster-scoped path for ClusterRole', async () => {
    const path = await buildApiPath({
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRole',
      metadata: { name: 'my-role' },
    });
    expect(path).toBe('/apis/rbac.authorization.k8s.io/v1/clusterroles');
  });

  test('builds cluster-scoped path for Node', async () => {
    const path = await buildApiPath({
      apiVersion: 'v1',
      kind: 'Node',
      metadata: { name: 'node-1' },
    });
    expect(path).toBe('/api/v1/nodes');
  });

  test('builds cluster-scoped path for CustomResourceDefinition', async () => {
    const path = await buildApiPath({
      apiVersion: 'apiextensions.k8s.io/v1',
      kind: 'CustomResourceDefinition',
      metadata: { name: 'my-crd' },
    });
    expect(path).toBe('/apis/apiextensions.k8s.io/v1/customresourcedefinitions');
  });

  test('builds cluster-scoped path for ValidatingWebhookConfiguration', async () => {
    const path = await buildApiPath({
      apiVersion: 'admissionregistration.k8s.io/v1',
      kind: 'ValidatingWebhookConfiguration',
      metadata: { name: 'my-webhook' },
    });
    expect(path).toBe('/apis/admissionregistration.k8s.io/v1/validatingwebhookconfigurations');
  });
});

describe('buildResourcePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDiscoveryCache();
    setupDiscoveryMock();
  });

  test('appends resource name to collection path', async () => {
    const path = await buildResourcePath({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'my-deploy', namespace: 'test-ns' },
    });
    expect(path).toBe('/apis/apps/v1/namespaces/test-ns/deployments/my-deploy');
  });

  test('returns collection path when no name is provided', async () => {
    const path = await buildResourcePath({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {},
    });
    expect(path).toBe('/api/v1/namespaces/default/configmaps');
  });
});

describe('dryRunApply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDiscoveryCache();
    setupDiscoveryMock();
  });

  test('calls clusterRequest with dryRun=All query parameter', async () => {
    const resource = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'test-deploy', namespace: 'default' },
      spec: {},
    };

    await dryRunApply(resource, 'my-cluster');

    expect(mockClusterRequest).toHaveBeenCalledWith(
      '/apis/apps/v1/namespaces/default/deployments?dryRun=All',
      {
        method: 'POST',
        body: JSON.stringify(resource),
        headers: { 'Content-Type': 'application/json' },
        cluster: 'my-cluster',
      }
    );
  });

  test('throws on 403 Gatekeeper error', async () => {
    mockClusterRequest.mockImplementation((url: string, opts: any) => {
      if (opts?.method === 'GET') {
        return Promise.resolve(appsV1Discovery);
      }
      return Promise.reject(
        new Error(
          'admission webhook "validation.gatekeeper.sh" denied the request: container image must not use latest tag'
        )
      );
    });

    const resource = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'test-deploy', namespace: 'default' },
      spec: {},
    };

    await expect(dryRunApply(resource, 'my-cluster')).rejects.toThrow(
      'admission webhook "validation.gatekeeper.sh" denied the request'
    );
  });

  test('succeeds when dry-run passes validation', async () => {
    const resource = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'test-svc', namespace: 'test-ns' },
      spec: {},
    };

    await expect(dryRunApply(resource)).resolves.toBeUndefined();

    expect(mockClusterRequest).toHaveBeenCalledWith(
      '/api/v1/namespaces/test-ns/services?dryRun=All',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('retries with PATCH on 409 AlreadyExists', async () => {
    const conflictError = errorWithStatus('AlreadyExists', 409);
    let postCalled = false;
    mockClusterRequest.mockImplementation((url: string, opts: any) => {
      if (opts?.method === 'GET') {
        return Promise.resolve(appsV1Discovery);
      }
      if (opts?.method === 'POST' && !postCalled) {
        postCalled = true;
        return Promise.reject(conflictError);
      }
      return Promise.resolve({});
    });

    const resource = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'existing-deploy', namespace: 'default' },
      spec: {},
    };

    await expect(dryRunApply(resource, 'my-cluster')).resolves.toBeUndefined();

    const postCalls = mockClusterRequest.mock.calls.filter(
      ([, opts]: [string, any]) => opts?.method === 'POST'
    );
    const patchCalls = mockClusterRequest.mock.calls.filter(
      ([, opts]: [string, any]) => opts?.method === 'PATCH'
    );
    expect(postCalls).toHaveLength(1);
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0][0]).toBe(
      '/apis/apps/v1/namespaces/default/deployments/existing-deploy?dryRun=All'
    );
    expect(patchCalls[0][1]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        cluster: 'my-cluster',
      })
    );
  });

  test('retries with PATCH on 409 from response property', async () => {
    const conflictError = errorWithStatus('Conflict', 409, true);
    let postCalled = false;
    mockClusterRequest.mockImplementation((url: string, opts: any) => {
      if (opts?.method === 'GET') {
        return Promise.resolve(coreV1Discovery);
      }
      if (opts?.method === 'POST' && !postCalled) {
        postCalled = true;
        return Promise.reject(conflictError);
      }
      return Promise.resolve({});
    });

    const resource = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'existing-svc', namespace: 'test-ns' },
      spec: {},
    };

    await expect(dryRunApply(resource)).resolves.toBeUndefined();

    const patchCalls = mockClusterRequest.mock.calls.filter(
      ([, opts]: [string, any]) => opts?.method === 'PATCH'
    );
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0][0]).toBe('/api/v1/namespaces/test-ns/services/existing-svc?dryRun=All');
  });

  test('re-throws non-409 errors', async () => {
    const forbiddenError = errorWithStatus('Forbidden', 403);
    mockClusterRequest.mockImplementation((url: string, opts: any) => {
      if (opts?.method === 'GET') {
        return Promise.resolve(appsV1Discovery);
      }
      return Promise.reject(forbiddenError);
    });

    const resource = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'test-deploy', namespace: 'default' },
      spec: {},
    };

    await expect(dryRunApply(resource)).rejects.toThrow('Forbidden');
    const postCalls = mockClusterRequest.mock.calls.filter(
      ([, opts]: [string, any]) => opts?.method === 'POST'
    );
    expect(postCalls).toHaveLength(1);
  });
});
