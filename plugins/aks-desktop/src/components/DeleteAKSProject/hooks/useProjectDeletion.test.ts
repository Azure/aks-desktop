// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockClusterAction = vi.hoisted(() => vi.fn());
const mockApiGet = vi.hoisted(() => vi.fn());
const mockApiEndpointDelete = vi.hoisted(() => vi.fn());
const mockApiEndpointPut = vi.hoisted(() => vi.fn());
const mockDeleteManagedNamespace = vi.hoisted(() => vi.fn());
const mockTrackAksFeature = vi.hoisted(() => vi.fn());
const mockTrackError = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  clusterAction: mockClusterAction,
  K8s: {
    ResourceClasses: {
      Namespace: {
        apiGet: mockApiGet,
        apiEndpoint: {
          delete: mockApiEndpointDelete,
          put: mockApiEndpointPut,
        },
      },
    },
  },
  useTranslation: () => ({ t: (s: string) => s }),
}));

vi.mock('../../../utils/azure/az-namespaces', () => ({
  deleteManagedNamespace: mockDeleteManagedNamespace,
}));

vi.mock('../../../telemetry/aksFeature', () => ({
  trackAksFeature: mockTrackAksFeature,
}));

vi.mock('../../../telemetry', () => ({
  trackError: mockTrackError,
}));

import { useProjectDeletion } from './useProjectDeletion';

const baseProject = {
  id: 'test-project',
  namespaces: ['test-ns'],
  clusters: ['test-cluster'],
};

function makeMockNs(labels: Record<string, string>, name = 'test-ns') {
  return {
    metadata: { name, labels },
    jsonData: { metadata: { name, labels: { ...labels } } },
    delete: vi.fn().mockResolvedValue(undefined),
    patch: vi.fn().mockResolvedValue(undefined),
  };
}

const aksLabels = {
  'headlamp.dev/project-id': 'test-project',
  'headlamp.dev/project-managed-by': 'aks-desktop',
  'aks-desktop/project-subscription': 'sub-123',
  'aks-desktop/project-resource-group': 'rg-test',
};

const regularLabels = {
  'headlamp.dev/project-id': 'test-project',
  'headlamp.dev/project-managed-by': 'headlamp',
};

// AKS Hybrid & Edge (Arc-connected) projects carry the aks-desktop managed-by
// label (set by the native manifest apply) but NO subscription/resource-group
// labels — there is no ARM resource behind them.
const arcLabels = {
  'headlamp.dev/project-id': 'test-project',
  'headlamp.dev/project-managed-by': 'aks-desktop',
};

// The same project as the wizard actually stamps it: the authorization model is
// recorded on the namespace, so it survives the loss of any local settings.
const arcLabelsWithModel = {
  ...arcLabels,
  'aks-desktop/project-authz-model': 'kubernetes-rbac',
};

/** Marks the project's cluster as an AKS Hybrid & Edge (Arc) cluster in cluster settings. */
function markClusterArc(clusterName = 'test-cluster') {
  localStorage.setItem(
    `cluster_settings.${clusterName}`,
    JSON.stringify({ clusterType: 'aksarc' })
  );
}

// Gets the async callback passed to clusterAction and runs it
async function executeClusterAction() {
  expect(mockClusterAction).toHaveBeenCalled();
  const actionFn = mockClusterAction.mock.calls[0][0];
  return actionFn();
}

// Makes mockApiGet return the given namespace
function setupApiGet(ns: ReturnType<typeof makeMockNs>) {
  mockApiGet.mockImplementation((successCb: Function) => {
    return () => successCb(ns);
  });
}

describe('useProjectDeletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  test('calls clusterAction and onClose immediately', () => {
    const onClose = vi.fn();
    mockApiGet.mockImplementation(() => () => {});
    mockClusterAction.mockImplementation(() => {});

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, false, onClose);

    expect(mockClusterAction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        successUrl: '/',
      })
    );
    expect(onClose).toHaveBeenCalled();
    expect(mockTrackAksFeature).toHaveBeenCalledWith('aksd.project-delete', 'started');
    expect(mockTrackAksFeature.mock.invocationCallOrder[0]).toBeLessThan(
      mockClusterAction.mock.invocationCallOrder[0]
    );
  });

  test('tracks success only after all deletion work completes', async () => {
    const ns = makeMockNs(regularLabels);
    let resolveDelete!: () => void;
    ns.delete.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveDelete = resolve;
        })
    );
    setupApiGet(ns);

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, true, vi.fn());

    const actionPromise = executeClusterAction();
    await vi.waitFor(() => expect(ns.delete).toHaveBeenCalled());
    expect(mockTrackAksFeature).not.toHaveBeenCalledWith('aksd.project-delete', 'succeeded');

    resolveDelete();
    await actionPromise;

    expect(mockTrackAksFeature.mock.calls).toEqual([
      ['aksd.project-delete', 'started'],
      ['aksd.project-delete', 'succeeded'],
    ]);
  });

  test('tracks categorical failure and rethrows the original error', async () => {
    const originalError = new Error('sensitive failure details');
    const ns = makeMockNs(regularLabels);
    ns.delete.mockRejectedValue(originalError);
    setupApiGet(ns);

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, true, vi.fn());

    await expect(executeClusterAction()).rejects.toBe(originalError);
    expect(mockTrackAksFeature.mock.calls).toEqual([
      ['aksd.project-delete', 'started'],
      ['aksd.project-delete', 'failed'],
    ]);
    expect(mockTrackError).toHaveBeenCalledWith({
      area: 'project-delete',
      errorClass: 'UnknownError',
      phase: 'failed',
    });
  });

  /** AKS Managed Namespaces */

  test('AKS managed + deleteNamespaces=true: calls ARM delete then K8s delete', async () => {
    const ns = makeMockNs(aksLabels);
    setupApiGet(ns);
    mockDeleteManagedNamespace.mockResolvedValue({ success: true });
    mockApiEndpointDelete.mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, true, vi.fn());

    await executeClusterAction();

    expect(mockDeleteManagedNamespace).toHaveBeenCalledWith({
      clusterName: 'test-cluster',
      resourceGroup: 'rg-test',
      namespaceName: 'test-ns',
      subscriptionId: 'sub-123',
    });
    expect(mockApiEndpointDelete).toHaveBeenCalledWith('test-ns', {}, 'test-cluster');
  });

  test('AKS managed with deleteNamespaces=false: calls ARM delete then removes labels', async () => {
    const ns = makeMockNs(aksLabels);
    setupApiGet(ns);
    mockDeleteManagedNamespace.mockResolvedValue({ success: true });
    mockApiEndpointPut.mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, false, vi.fn());

    await executeClusterAction();

    expect(mockDeleteManagedNamespace).toHaveBeenCalled();
    expect(mockApiEndpointPut).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          labels: expect.not.objectContaining({
            'headlamp.dev/project-id': expect.anything(),
          }),
        }),
      }),
      {},
      'test-cluster'
    );
  });

  test('AKS managed: throws when ARM deletion fails', async () => {
    const ns = makeMockNs(aksLabels);
    setupApiGet(ns);
    mockDeleteManagedNamespace.mockResolvedValue({ success: false, error: 'ARM failed' });

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, false, vi.fn());

    await expect(executeClusterAction()).rejects.toThrow('ARM failed');
  });

  test('AKS managed: throws when required Azure labels are missing', async () => {
    const ns = makeMockNs({
      'headlamp.dev/project-managed-by': 'aks-desktop',
      // (Missing resource group and subscription labels)
    });
    setupApiGet(ns);

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, false, vi.fn());

    await expect(executeClusterAction()).rejects.toThrow('Missing required Azure labels');
  });

  test('ARM marker takes precedence over stale Arc labels and cluster settings', async () => {
    markClusterArc();
    const ns = makeMockNs({
      ...aksLabels,
      'aks-desktop/project-authz-model': 'kubernetes-rbac',
      'kubernetes.azure.com/managedByArm': 'true',
    });
    setupApiGet(ns);
    mockDeleteManagedNamespace.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, false, vi.fn());

    await executeClusterAction();

    expect(mockDeleteManagedNamespace).toHaveBeenCalledWith({
      clusterName: 'test-cluster',
      resourceGroup: 'rg-test',
      namespaceName: 'test-ns',
      subscriptionId: 'sub-123',
    });
  });

  /** AKS Hybrid & Edge (Arc-connected) Namespaces */

  test('AKS Hybrid & Edge cluster + deleteNamespaces=true: native K8s delete, no ARM call', async () => {
    markClusterArc();
    const ns = makeMockNs(arcLabels);
    setupApiGet(ns);

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, true, vi.fn());

    await executeClusterAction();

    // Even though the namespace carries the aks-desktop managed-by label, an
    // AKS Hybrid & Edge cluster deletes natively — no `az aks namespace delete`.
    expect(ns.delete).toHaveBeenCalled();
    expect(mockDeleteManagedNamespace).not.toHaveBeenCalled();
  });

  test('Arc project is recognised from its namespace labels when cluster settings are gone', async () => {
    // Cluster settings live in localStorage and are absent after the kubeconfig
    // moves to another installation while the namespace persists. Without reading
    // the durable label, this project would be misread as managed AKS and deleted
    // with `az aks namespace delete` against a connected cluster.
    // Note: no markClusterArc() here — that is the point.
    const ns = makeMockNs(arcLabelsWithModel);
    setupApiGet(ns);

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, true, vi.fn());

    await executeClusterAction();

    expect(ns.delete).toHaveBeenCalled();
    expect(mockDeleteManagedNamespace).not.toHaveBeenCalled();
  });

  test('AKS Hybrid & Edge cluster + deleteNamespaces=false: merge-patches labels to null, no ARM call', async () => {
    markClusterArc();
    const ns = makeMockNs(arcLabels);
    setupApiGet(ns);

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, false, vi.fn());

    await executeClusterAction();

    // A merge patch that clears just the project labels (null deletes the key) —
    // the namespace is not rewritten and no `az` call is made.
    expect(ns.patch).toHaveBeenCalledWith({
      metadata: {
        labels: {
          'headlamp.dev/project-id': null,
          'headlamp.dev/project-managed-by': null,
        },
      },
    });
    expect(mockApiEndpointPut).not.toHaveBeenCalled();
    expect(mockDeleteManagedNamespace).not.toHaveBeenCalled();
  });

  /** Regular Kubernetes Namespaces */

  test('regular namespace with deleteNamespaces=true: calls ns.delete()', async () => {
    const ns = makeMockNs(regularLabels);
    setupApiGet(ns);

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, true, vi.fn());

    await executeClusterAction();

    expect(ns.delete).toHaveBeenCalled();
    expect(mockDeleteManagedNamespace).not.toHaveBeenCalled();
  });

  test('regular namespace with deleteNamespaces=false: merge-patches labels to null', async () => {
    const ns = makeMockNs(regularLabels);
    setupApiGet(ns);

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, false, vi.fn());

    await executeClusterAction();

    expect(ns.patch).toHaveBeenCalledWith({
      metadata: {
        labels: {
          'headlamp.dev/project-id': null,
          'headlamp.dev/project-managed-by': null,
        },
      },
    });
    expect(mockApiEndpointPut).not.toHaveBeenCalled();
    expect(mockDeleteManagedNamespace).not.toHaveBeenCalled();
  });
});
