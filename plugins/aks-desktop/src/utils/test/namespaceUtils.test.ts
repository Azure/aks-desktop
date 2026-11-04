// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the K8s API. These are declared with vi.hoisted so the vi.mock factory
// (hoisted above imports) can safely reference them.
const { mockGet, mockPut, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPut: vi.fn(),
  mockPost: vi.fn(),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Namespace: {
        apiEndpoint: {
          get: (...args: any[]) => mockGet(...args),
          put: (...args: any[]) => mockPut(...args),
          post: (...args: any[]) => mockPost(...args),
        },
      },
    },
  },
}));

// applyNamespaceManifest creates the Namespace with create-only semantics and
// applies the namespaced children with the generic apply() helper.
const mockApply = vi.hoisted(() => vi.fn());
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({
  apply: (...args: any[]) => mockApply(...args),
}));

const mockUpdateManagedNamespace = vi.hoisted(() => vi.fn());
vi.mock('../azure/az-namespaces', () => ({
  updateManagedNamespace: mockUpdateManagedNamespace,
}));

import {
  applyNamespaceManifest,
  applyProjectLabels,
  fetchNamespaceData,
} from '../kubernetes/namespaceUtils';

/**
 * Helper: creates a mockGet implementation that calls the success callback
 * asynchronously (via queueMicrotask) so that cancelFn is assigned before
 * the callback accesses it — matching real Headlamp API behaviour.
 */
function mockGetSuccess(response: any, mockCancel: ReturnType<typeof vi.fn> = vi.fn()) {
  mockGet.mockImplementation((_name: string, successCb: (ns: any) => void) => {
    const cancelPromise = Promise.resolve(mockCancel);
    queueMicrotask(() => successCb(response));
    return cancelPromise;
  });
  return mockCancel;
}

function mockGetError(error: any, mockCancel: ReturnType<typeof vi.fn> = vi.fn()) {
  mockGet.mockImplementation(
    (_name: string, _successCb: (ns: any) => void, errorCb: (err: any) => void) => {
      const cancelPromise = Promise.resolve(mockCancel);
      queueMicrotask(() => errorCb(error));
      return cancelPromise;
    }
  );
  return mockCancel;
}

describe('fetchNamespaceData', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
  });

  test('resolves with namespace data', async () => {
    const mockNs = { metadata: { name: 'test-ns', labels: {} } };
    mockGetSuccess(mockNs);

    const result = await fetchNamespaceData('test-ns', 'test-cluster');

    expect(result).toEqual(mockNs);
    expect(mockGet).toHaveBeenCalledWith(
      'test-ns',
      expect.any(Function),
      expect.any(Function),
      {},
      'test-cluster'
    );
  });

  test('calls cancel function on success', async () => {
    const mockCancel = mockGetSuccess({ metadata: {} });

    await fetchNamespaceData('test-ns', 'test-cluster');

    // Wait for the cancelFn.then to resolve
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockCancel).toHaveBeenCalled();
  });

  test('rejects with error on failure', async () => {
    mockGetError('Not found');

    await expect(fetchNamespaceData('missing-ns', 'test-cluster')).rejects.toThrow(
      'Failed to fetch namespace: Not found'
    );
  });

  test('calls cancel function on error', async () => {
    const mockCancel = mockGetError('Not found');

    try {
      await fetchNamespaceData('missing-ns', 'test-cluster');
    } catch {
      // Expected
    }

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockCancel).toHaveBeenCalled();
  });
});

describe('applyNamespaceManifest', () => {
  beforeEach(() => {
    mockApply.mockReset();
    mockPost.mockReset();
  });

  const baseOptions = {
    namespaceName: 'my-project',
    cpuRequest: 2000,
    cpuLimit: 4000,
    memoryRequest: 4096,
    memoryLimit: 8192,
    ingressPolicy: 'AllowSameNamespace' as const,
    egressPolicy: 'AllowAll' as const,
    labels: { 'headlamp.dev/project-id': 'my-project' },
    userAssignments: [
      { objectId: '11111111-1111-1111-1111-111111111111', upn: 'ada@contoso.com', role: 'Admin' },
    ],
  };

  test('creates the Namespace create-only, then applies its children', async () => {
    // `apply` is create-or-update, which would adopt someone else's namespace and
    // stamp it with this project's labels if the wizard's pre-check lost a race.
    mockPost.mockResolvedValue({});
    mockApply.mockResolvedValue({});

    const result = await applyNamespaceManifest('arc-cluster', baseOptions);

    expect(result).toEqual({ success: true });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0].kind).toBe('Namespace');
    expect(mockPost.mock.calls[0][2]).toBe('arc-cluster');

    const appliedKinds = mockApply.mock.calls.map(call => call[0].kind);
    expect(appliedKinds).toEqual(['ResourceQuota', 'NetworkPolicy', 'RoleBinding']);
    for (const call of mockApply.mock.calls) {
      expect(call[1]).toBe('arc-cluster');
    }
  });

  test('reports the collision when the namespace already exists', async () => {
    mockPost.mockRejectedValue(new Error('namespaces "my-project" already exists'));

    const result = await applyNamespaceManifest('arc-cluster', baseOptions);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Namespace');
    // Nothing is applied into a namespace we do not own.
    expect(mockApply).not.toHaveBeenCalled();
  });

  test('fails fast and reports the failing kind on error', async () => {
    // Namespace succeeds, ResourceQuota rejects.
    mockPost.mockResolvedValue({});
    mockApply.mockRejectedValueOnce(new Error('quota exceeded'));

    const result = await applyNamespaceManifest('arc-cluster', baseOptions);

    expect(result.success).toBe(false);
    expect(result.error).toContain('ResourceQuota');
    expect(result.error).toContain('quota exceeded');
    // Stopped after the failure — NetworkPolicy/RoleBinding were not attempted.
    // Only one apply: the Namespace is created through the endpoint, not applied.
    expect(mockApply).toHaveBeenCalledTimes(1);
  });
});

describe('applyProjectLabels', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
    mockUpdateManagedNamespace.mockReset();
  });

  describe('managed namespaces (via the shared ARM update helper)', () => {
    const managedOptions = {
      namespaceName: 'test-ns',
      clusterName: 'test-cluster',
      subscriptionId: 'sub-123',
      resourceGroup: 'rg-test',
    };

    test('passes only four label overrides and scope, delegating existing-state merging to the helper', async () => {
      const currentState = {
        id: '/subscriptions/sub-123/resourceGroups/rg-test/providers/Microsoft.ContainerService/managedClusters/test-cluster/managedNamespaces/test-ns',
        properties: {
          labels: {
            'existing-label': 'keep',
            'headlamp.dev/project-id': 'test-ns',
            'headlamp.dev/project-managed-by': 'aks-desktop',
            'aks-desktop/project-subscription': 'sub-123',
            'aks-desktop/project-resource-group': 'rg-test',
          },
          annotations: { owner: 'team-a' },
          defaultResourceQuota: { cpuRequest: '500m', memoryLimit: '512Mi' },
          defaultNetworkPolicy: { ingress: 'DenyAll', egress: 'AllowAll' },
        },
      };
      mockUpdateManagedNamespace.mockResolvedValue(currentState);

      await expect(applyProjectLabels(managedOptions)).resolves.toBeUndefined();

      expect(mockUpdateManagedNamespace).toHaveBeenCalledTimes(1);
      expect(mockUpdateManagedNamespace).toHaveBeenCalledWith({
        ...managedOptions,
        labels: {
          'headlamp.dev/project-id': 'test-ns',
          'headlamp.dev/project-managed-by': 'aks-desktop',
          'aks-desktop/project-subscription': 'sub-123',
          'aks-desktop/project-resource-group': 'rg-test',
        },
      });
      // No replacement state, quota/policy defaults or noWait opt-out is supplied.
      // The helper owns the GET and label merge; the caller must not duplicate it.
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockPut).not.toHaveBeenCalled();
    });

    test('waits for the shared helper to finish before completing conversion', async () => {
      let finishUpdate!: (value: object) => void;
      mockUpdateManagedNamespace.mockReturnValue(
        new Promise(resolve => {
          finishUpdate = resolve;
        })
      );
      const completed = vi.fn();
      const applying = applyProjectLabels(managedOptions).then(completed);

      expect(mockUpdateManagedNamespace).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      expect(completed).not.toHaveBeenCalled();

      finishUpdate({ properties: { provisioningState: 'Succeeded' } });
      await applying;
      expect(completed).toHaveBeenCalledTimes(1);
    });

    test.each([
      'GET failed: HTTP 403 Forbidden',
      'PUT failed: HTTP 409 Conflict',
      'Operation failed: terminal provisioning failure',
    ])('propagates helper failure unchanged: %s', async message => {
      const error = new Error(message);
      mockUpdateManagedNamespace.mockRejectedValue(error);

      await expect(applyProjectLabels(managedOptions)).rejects.toBe(error);
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockPut).not.toHaveBeenCalled();
    });
  });

  describe('regular namespaces (via K8s API)', () => {
    test.each([
      { subscriptionId: '', resourceGroup: '' },
      { subscriptionId: 'sub-123', resourceGroup: '' },
      { subscriptionId: '', resourceGroup: 'rg-test' },
    ])('preserves the full K8s object when Azure scope is incomplete: %j', async scope => {
      const existingNs = {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name: 'test-ns',
          labels: { 'existing-label': 'value', 'headlamp.dev/project-id': 'old-project' },
          annotations: { owner: 'team-a' },
          resourceVersion: '12345',
          uid: 'namespace-uid',
        },
        spec: { finalizers: ['kubernetes'] },
        status: { phase: 'Active' },
      };
      mockGetSuccess(existingNs);
      mockPut.mockResolvedValue({});

      await applyProjectLabels({
        namespaceName: 'test-ns',
        clusterName: 'test-cluster',
        ...scope,
      });

      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledWith(
        {
          ...existingNs,
          metadata: {
            ...existingNs.metadata,
            labels: {
              'existing-label': 'value',
              'headlamp.dev/project-id': 'test-ns',
              'headlamp.dev/project-managed-by': 'aks-desktop',
            },
          },
        },
        {},
        'test-cluster'
      );
      expect(existingNs.metadata.labels['headlamp.dev/project-id']).toBe('old-project');
      const updatedLabels = mockPut.mock.calls[0][0].metadata.labels;
      expect(updatedLabels['existing-label']).toBe('value');
      expect(updatedLabels['headlamp.dev/project-id']).toBe('test-ns');
      expect(updatedLabels['headlamp.dev/project-managed-by']).toBe('aks-desktop');
      expect(updatedLabels).not.toHaveProperty('aks-desktop/project-subscription');
      expect(updatedLabels).not.toHaveProperty('aks-desktop/project-resource-group');
      expect(mockPut.mock.calls[0][2]).toBe('test-cluster');

      expect(mockUpdateManagedNamespace).not.toHaveBeenCalled();
    });

    test('handles namespace with no existing labels', async () => {
      const existingNs = {
        metadata: { name: 'test-ns' },
      };
      mockGetSuccess(existingNs);
      mockPut.mockResolvedValue({});

      await applyProjectLabels({
        namespaceName: 'test-ns',
        clusterName: 'test-cluster',
        subscriptionId: '',
        resourceGroup: '',
      });

      const updatedLabels = mockPut.mock.calls[0][0].metadata.labels;
      expect(updatedLabels['headlamp.dev/project-id']).toBe('test-ns');
      expect(updatedLabels['headlamp.dev/project-managed-by']).toBe('aks-desktop');
    });

    test('throws when fetch fails', async () => {
      mockGetError('Namespace not found');

      await expect(
        applyProjectLabels({
          namespaceName: 'missing-ns',
          clusterName: 'test-cluster',
          subscriptionId: '',
          resourceGroup: '',
        })
      ).rejects.toThrow('Failed to fetch namespace');
    });

    test('throws when put fails', async () => {
      const existingNs = { metadata: { name: 'test-ns', labels: {} } };
      mockGetSuccess(existingNs);
      mockPut.mockRejectedValue(new Error('Forbidden'));

      await expect(
        applyProjectLabels({
          namespaceName: 'test-ns',
          clusterName: 'test-cluster',
          subscriptionId: '',
          resourceGroup: '',
        })
      ).rejects.toThrow('Forbidden');
    });
  });
});
