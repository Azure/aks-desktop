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

  test('regular namespace with deleteNamespaces=false: removes project labels', async () => {
    const ns = makeMockNs(regularLabels);
    setupApiGet(ns);
    mockApiEndpointPut.mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectDeletion());
    result.current.handleDelete(baseProject, false, vi.fn());

    await executeClusterAction();

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
    expect(mockDeleteManagedNamespace).not.toHaveBeenCalled();
  });
});
