// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the K8s API. These are declared with vi.hoisted so the vi.mock factory
// (hoisted above imports) can safely reference them.
const { mockGet, mockPut } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPut: vi.fn(),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Namespace: {
        apiEndpoint: {
          get: (...args: any[]) => mockGet(...args),
          put: (...args: any[]) => mockPut(...args),
        },
      },
    },
  },
}));

// applyNamespaceManifest applies each object via Headlamp's generic apply() helper
// (create-or-update), imported from the public ApiProxy entry — mock that.
const mockApply = vi.hoisted(() => vi.fn());
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({
  apply: (...args: any[]) => mockApply(...args),
}));

// Mock the Azure CLI
const mockRunCommandAsync = vi.fn();
vi.mock('../azure/az-cli-core', () => ({
  runCommandAsync: (...args: any[]) => mockRunCommandAsync(...args),
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

  test('applies every object in order to the given cluster via apply()', async () => {
    mockApply.mockResolvedValue({});

    const result = await applyNamespaceManifest('arc-cluster', baseOptions);

    expect(result).toEqual({ success: true });
    // Namespace first, then the namespaced children.
    const appliedKinds = mockApply.mock.calls.map(call => call[0].kind);
    expect(appliedKinds).toEqual(['Namespace', 'ResourceQuota', 'NetworkPolicy', 'RoleBinding']);
    // Every apply targets the cluster context (2nd positional arg).
    for (const call of mockApply.mock.calls) {
      expect(call[1]).toBe('arc-cluster');
    }
  });

  test('fails fast and reports the failing kind on error', async () => {
    // Namespace succeeds, ResourceQuota rejects.
    mockApply.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('quota exceeded'));

    const result = await applyNamespaceManifest('arc-cluster', baseOptions);

    expect(result.success).toBe(false);
    expect(result.error).toContain('ResourceQuota');
    expect(result.error).toContain('quota exceeded');
    // Stopped after the failure — NetworkPolicy/RoleBinding were not attempted.
    expect(mockApply).toHaveBeenCalledTimes(2);
  });
});

describe('applyProjectLabels', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
    mockRunCommandAsync.mockReset();
  });

  describe('managed namespaces (via Azure CLI)', () => {
    test('applies labels via az aks namespace update', async () => {
      mockRunCommandAsync.mockResolvedValue({ stdout: '{}', stderr: '' });

      await applyProjectLabels({
        namespaceName: 'test-ns',
        clusterName: 'test-cluster',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-test',
      });

      expect(mockRunCommandAsync).toHaveBeenCalledTimes(1);
      const [cmd, args] = mockRunCommandAsync.mock.calls[0];
      expect(cmd).toBe('az');
      expect(args).toContain('namespace');
      expect(args).toContain('update');
      expect(args).toContain('--resource-group');
      expect(args).toContain('rg-test');
      expect(args).toContain('--cluster-name');
      expect(args).toContain('test-cluster');
      expect(args).toContain('--name');
      expect(args).toContain('test-ns');
      expect(args).toContain('--subscription');
      expect(args).toContain('sub-123');
      expect(args).toContain('--labels');

      // Labels are passed as separate arguments after --labels (space-separated, not comma-joined)
      const labelsStartIdx = args.indexOf('--labels') + 1;
      const labelArgs = args.slice(labelsStartIdx);
      expect(labelArgs).toContain('headlamp.dev/project-id=test-ns');
      expect(labelArgs).toContain('headlamp.dev/project-managed-by=aks-desktop');
      expect(labelArgs).toContain('aks-desktop/project-subscription=sub-123');
      expect(labelArgs).toContain('aks-desktop/project-resource-group=rg-test');

      // Should NOT use the K8s API for managed namespaces
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockPut).not.toHaveBeenCalled();
    });

    test('throws when az CLI returns an error', async () => {
      mockRunCommandAsync.mockResolvedValue({
        stdout: '',
        stderr: 'ERROR: Resource not found',
      });

      await expect(
        applyProjectLabels({
          namespaceName: 'test-ns',
          clusterName: 'test-cluster',
          subscriptionId: 'sub-123',
          resourceGroup: 'rg-test',
        })
      ).rejects.toThrow('ERROR: Resource not found');
    });

    test('succeeds when stderr contains warnings but no ERROR', async () => {
      mockRunCommandAsync.mockResolvedValue({
        stdout: '{}',
        stderr: 'WARNING: some deprecation notice',
      });

      await expect(
        applyProjectLabels({
          namespaceName: 'test-ns',
          clusterName: 'test-cluster',
          subscriptionId: 'sub-123',
          resourceGroup: 'rg-test',
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('regular namespaces (via K8s API)', () => {
    test('applies project labels via K8s API when no Azure metadata', async () => {
      const existingNs = {
        metadata: {
          name: 'test-ns',
          labels: { 'existing-label': 'value' },
        },
      };
      mockGetSuccess(existingNs);
      mockPut.mockResolvedValue({});

      await applyProjectLabels({
        namespaceName: 'test-ns',
        clusterName: 'test-cluster',
        subscriptionId: '',
        resourceGroup: '',
      });

      expect(mockPut).toHaveBeenCalledTimes(1);
      const updatedLabels = mockPut.mock.calls[0][0].metadata.labels;
      expect(updatedLabels['existing-label']).toBe('value');
      expect(updatedLabels['headlamp.dev/project-id']).toBe('test-ns');
      expect(updatedLabels['headlamp.dev/project-managed-by']).toBe('aks-desktop');
      expect(updatedLabels).not.toHaveProperty('aks-desktop/project-subscription');
      expect(updatedLabels).not.toHaveProperty('aks-desktop/project-resource-group');
      expect(mockPut.mock.calls[0][2]).toBe('test-cluster');

      // Should NOT use the Azure CLI for regular namespaces
      expect(mockRunCommandAsync).not.toHaveBeenCalled();
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
