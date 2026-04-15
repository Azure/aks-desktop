// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Create mock functions before vi.mock calls
const mockRunCommandAsync = vi.fn();
const mockApiList = vi.fn();
const mockUseClustersConf = vi.fn();

vi.mock('../utils/azure/az-cli-core', () => ({
  runCommandAsync: (...args: any[]) => mockRunCommandAsync(...args),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Namespace: {
        apiList: (...args: any[]) => mockApiList(...args),
      },
    },
    useClustersConf: () => mockUseClustersConf(),
  },
}));

import { useNamespaceDiscovery } from './useNamespaceDiscovery';

// --- Helpers ---

/** Builds a valid Azure Resource Graph JSON response for managed namespaces. */
function buildManagedResponse(
  items: Array<{
    name: string;
    clusterId: string;
    resourceGroup: string;
    subscriptionId: string;
    labels?: Record<string, string> | null;
    provisioningState?: string;
  }>
) {
  return {
    stdout: JSON.stringify({
      data: items.map(item => ({
        id: item.clusterId,
        name: item.name,
        resourceGroup: item.resourceGroup,
        subscriptionId: item.subscriptionId,
        labels: item.labels ?? null,
        provisioningState: item.provisioningState ?? 'Succeeded',
      })),
    }),
    stderr: '',
  };
}

/** Builds a mock K8s namespace object as returned by the apiList callback. */
function buildK8sNamespace(
  name: string,
  labels: Record<string, string> | null = null
): { jsonData: { metadata: { name: string; labels: Record<string, string> | null } } } {
  return {
    jsonData: {
      metadata: { name, labels },
    },
  };
}

/**
 * Sets up mockApiList to call the success callback with the provided namespaces.
 * The source code invokes apiList(...args)() — calling the returned function immediately.
 * So mockApiList must return a function that triggers the callback.
 */
function setupApiListSuccess(namespacesByCluster: Record<string, any[]>) {
  mockApiList.mockImplementation(
    (successCb: (namespaces: any[]) => void, _errorCb: (err: any) => void, opts: any) => {
      return () => {
        const namespaces = namespacesByCluster[opts?.cluster] ?? [];
        queueMicrotask(() => successCb(namespaces));
        return () => {}; // unsubscribe
      };
    }
  );
}

describe('useNamespaceDiscovery', () => {
  beforeEach(() => {
    mockRunCommandAsync.mockReset();
    mockApiList.mockReset();
    mockUseClustersConf.mockReset();
    localStorage.clear();

    // Default: no clusters registered, managed namespace discovery returns empty
    mockUseClustersConf.mockReturnValue({});
    mockRunCommandAsync.mockResolvedValue(buildManagedResponse([]));
    setupApiListSuccess({});
  });

  afterEach(() => {
    cleanup();
    delete (window as any).desktopApi;
  });

  // -----------------------------------------------------------------------
  // Test 1: Initial state
  // -----------------------------------------------------------------------
  test('initial state returns loading=true and empty arrays', () => {
    // Make runCommandAsync never resolve so we stay in loading state
    mockRunCommandAsync.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useNamespaceDiscovery());

    expect(result.current.loading).toBe(true);
    expect(result.current.namespaces).toEqual([]);
    expect(result.current.needsConversion).toEqual([]);
    expect(result.current.needsImport).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.refresh).toBe('function');
  });

  // -----------------------------------------------------------------------
  // Test 2: Managed namespace discovery via Azure Resource Graph
  // -----------------------------------------------------------------------
  test('discovers managed namespaces via Azure Resource Graph with correct data', async () => {
    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          name: 'app-ns',
          clusterId:
            '/subscriptions/sub-111/resourceGroups/rg-east/providers/Microsoft.ContainerService/managedClusters/my-cluster/managedNamespaces/app-ns',
          resourceGroup: 'rg-east',
          subscriptionId: 'sub-111',
          labels: null,
          provisioningState: 'Succeeded',
        },
      ])
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    const ns = result.current.namespaces[0];
    expect(ns.name).toBe('app-ns');
    expect(ns.clusterName).toBe('my-cluster');
    expect(ns.resourceGroup).toBe('rg-east');
    expect(ns.subscriptionId).toBe('sub-111');
    expect(ns.isManagedNamespace).toBe(true);
    expect(ns.provisioningState).toBe('Succeeded');
  });

  // -----------------------------------------------------------------------
  // Test 3: Regular namespace discovery via K8s API
  // -----------------------------------------------------------------------
  test('discovers regular namespaces via K8s API with correct data', async () => {
    // Make managed discovery return empty
    mockRunCommandAsync.mockResolvedValue(buildManagedResponse([]));

    mockUseClustersConf.mockReturnValue({ 'my-cluster': {} });
    setupApiListSuccess({
      'my-cluster': [buildK8sNamespace('web-app', { team: 'platform' })],
    });

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    const ns = result.current.namespaces[0];
    expect(ns.name).toBe('web-app');
    expect(ns.clusterName).toBe('my-cluster');
    expect(ns.isManagedNamespace).toBe(false);
    expect(ns.resourceGroup).toBe('');
    expect(ns.subscriptionId).toBe('');
    expect(ns.labels).toEqual({ team: 'platform' });
  });

  // -----------------------------------------------------------------------
  // Test 4: Deduplication — managed version wins over regular
  // -----------------------------------------------------------------------
  test('deduplicates namespaces with managed version winning over regular', async () => {
    // Managed path returns a namespace on my-cluster
    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          name: 'shared-ns',
          clusterId:
            '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ContainerService/managedClusters/my-cluster/managedNamespaces/shared-ns',
          resourceGroup: 'rg-1',
          subscriptionId: 'sub-1',
        },
      ])
    );

    // K8s API also returns the same namespace on same cluster
    mockUseClustersConf.mockReturnValue({ 'my-cluster': {} });
    setupApiListSuccess({
      'my-cluster': [buildK8sNamespace('shared-ns')],
    });

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Only one result (deduplicated)
    expect(result.current.namespaces).toHaveLength(1);
    // The managed version should win (has richer metadata)
    expect(result.current.namespaces[0].isManagedNamespace).toBe(true);
    expect(result.current.namespaces[0].resourceGroup).toBe('rg-1');
    expect(result.current.namespaces[0].subscriptionId).toBe('sub-1');
  });

  // -----------------------------------------------------------------------
  // Test 5: System namespace filtering
  // -----------------------------------------------------------------------
  test('filters out system namespaces', async () => {
    const systemNamespaces = [
      'kube-system',
      'kube-public',
      'kube-node-lease',
      'default',
      'gatekeeper-system',
    ];

    // Put system namespaces in managed response
    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse(
        systemNamespaces.map(name => ({
          name,
          clusterId: `/subscriptions/s/resourceGroups/r/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/${name}`,
          resourceGroup: 'rg',
          subscriptionId: 'sub',
        }))
      )
    );

    // Also put system namespaces in K8s API response
    mockUseClustersConf.mockReturnValue({ c: {} });
    setupApiListSuccess({
      c: systemNamespaces.map(name => buildK8sNamespace(name)),
    });

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Test 6: Already-imported filtering via localStorage
  // -----------------------------------------------------------------------
  test('filters out namespaces already imported AND labeled in localStorage', async () => {
    // Register the cluster so isAlreadyImported can filter managed namespaces.
    // Unregistered clusters skip the isAlreadyImported check because stale
    // localStorage entries would incorrectly hide namespaces.
    mockUseClustersConf.mockReturnValue({ 'my-cluster': {} });
    setupApiListSuccess({ 'my-cluster': [] });

    localStorage.setItem(
      'cluster_settings.my-cluster',
      JSON.stringify({ allowedNamespaces: ['imported-ns', 'unlabeled-imported'] })
    );

    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          name: 'imported-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/my-cluster/managedNamespaces/imported-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
          labels: {
            'headlamp.dev/project-id': 'imported-ns',
            'headlamp.dev/project-managed-by': 'aks-desktop',
          },
        },
        {
          name: 'unlabeled-imported',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/my-cluster/managedNamespaces/unlabeled-imported',
          resourceGroup: 'rg',
          subscriptionId: 's',
        },
        {
          name: 'not-imported-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/my-cluster/managedNamespaces/not-imported-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
        },
      ])
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // imported-ns is filtered (has labels + in allowedNamespaces)
    // unlabeled-imported is NOT filtered (in allowedNamespaces but lacks labels — needs conversion)
    // not-imported-ns is NOT filtered (not in allowedNamespaces)
    expect(result.current.namespaces).toHaveLength(2);
    expect(result.current.namespaces.map(ns => ns.name).sort()).toEqual([
      'not-imported-ns',
      'unlabeled-imported',
    ]);
  });

  // -----------------------------------------------------------------------
  // Test 6b: Stale localStorage on unregistered cluster does not hide namespaces
  // -----------------------------------------------------------------------
  test('does not filter labeled namespace on unregistered cluster even with stale localStorage', async () => {
    // cluster-unreg is NOT registered (default mockUseClustersConf returns {})
    // but has stale allowedNamespaces from a previous registration
    localStorage.setItem(
      'cluster_settings.cluster-unreg',
      JSON.stringify({ allowedNamespaces: ['labeled-ns'] })
    );

    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          name: 'labeled-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/cluster-unreg/managedNamespaces/labeled-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
          labels: {
            'headlamp.dev/project-id': 'labeled-ns',
            'headlamp.dev/project-managed-by': 'aks-desktop',
          },
        },
      ])
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // The namespace should NOT be filtered — even though it has labels and is
    // in allowedNamespaces — because cluster-unreg is not registered, so the
    // namespace can't be visible as a project. Filtering it would make it vanish.
    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].name).toBe('labeled-ns');
  });

  // -----------------------------------------------------------------------
  // Test 7: Category assignment based on labels
  // -----------------------------------------------------------------------
  test('assigns needs-import category to labeled namespaces and needs-conversion to unlabeled', async () => {
    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          name: 'labeled-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/labeled-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
          labels: {
            'headlamp.dev/project-id': 'labeled-ns',
            'headlamp.dev/project-managed-by': 'aks-desktop',
          },
        },
        {
          name: 'unlabeled-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/unlabeled-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
          labels: null,
        },
      ])
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const labeled = result.current.namespaces.find(ns => ns.name === 'labeled-ns');
    const unlabeled = result.current.namespaces.find(ns => ns.name === 'unlabeled-ns');

    expect(labeled).toBeDefined();
    expect(labeled!.category).toBe('needs-import');
    expect(labeled!.isAksProject).toBe(true);

    expect(unlabeled).toBeDefined();
    expect(unlabeled!.category).toBe('needs-conversion');
    expect(unlabeled!.isAksProject).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Test 8: needsConversion / needsImport arrays correctly partitioned
  // -----------------------------------------------------------------------
  test('partitions namespaces into needsConversion and needsImport arrays', async () => {
    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          name: 'import-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/import-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
          labels: {
            'headlamp.dev/project-id': 'import-ns',
            'headlamp.dev/project-managed-by': 'aks-desktop',
          },
        },
        {
          name: 'convert-ns-1',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/convert-ns-1',
          resourceGroup: 'rg',
          subscriptionId: 's',
          labels: null,
        },
        {
          name: 'convert-ns-2',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/convert-ns-2',
          resourceGroup: 'rg',
          subscriptionId: 's',
          labels: null,
        },
      ])
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.needsImport).toHaveLength(1);
    expect(result.current.needsImport[0].name).toBe('import-ns');

    expect(result.current.needsConversion).toHaveLength(2);
    expect(result.current.needsConversion.map(ns => ns.name)).toEqual([
      'convert-ns-1',
      'convert-ns-2',
    ]);
  });

  // -----------------------------------------------------------------------
  // Test 9: Azure Resource Graph failure doesn't crash; regular discovery proceeds
  // -----------------------------------------------------------------------
  test('handles Azure Resource Graph failure gracefully and continues with regular discovery', async () => {
    mockRunCommandAsync.mockRejectedValue(new Error('az graph query failed'));

    mockUseClustersConf.mockReturnValue({ 'cluster-a': {} });
    setupApiListSuccess({
      'cluster-a': [buildK8sNamespace('fallback-ns')],
    });

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Regular discovery should still work
    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].name).toBe('fallback-ns');
    expect(result.current.namespaces[0].isManagedNamespace).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Test 10: K8s API failure for one cluster doesn't affect others
  // -----------------------------------------------------------------------
  test('handles K8s API failure for one cluster without affecting others', async () => {
    mockRunCommandAsync.mockResolvedValue(buildManagedResponse([]));

    mockUseClustersConf.mockReturnValue({ 'cluster-ok': {}, 'cluster-fail': {} });

    // Use a custom mockApiList implementation that succeeds for one cluster and fails for another
    mockApiList.mockImplementation(
      (successCb: (namespaces: any[]) => void, errorCb: (err: any) => void, opts: any) => {
        return () => {
          if (opts?.cluster === 'cluster-fail') {
            queueMicrotask(() => errorCb('Connection refused'));
          } else {
            queueMicrotask(() => successCb([buildK8sNamespace('surviving-ns')]));
          }
          return () => {}; // unsubscribe
        };
      }
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].name).toBe('surviving-ns');
    expect(result.current.namespaces[0].clusterName).toBe('cluster-ok');
  });

  // -----------------------------------------------------------------------
  // Test 11: refresh() re-triggers discovery
  // -----------------------------------------------------------------------
  test('refresh() re-triggers discovery with updated data', async () => {
    // First call returns one namespace
    mockRunCommandAsync.mockResolvedValueOnce(
      buildManagedResponse([
        {
          name: 'ns-v1',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/ns-v1',
          resourceGroup: 'rg',
          subscriptionId: 's',
        },
      ])
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].name).toBe('ns-v1');

    // Set up new data for refresh
    mockRunCommandAsync.mockResolvedValueOnce(
      buildManagedResponse([
        {
          name: 'ns-v1',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/ns-v1',
          resourceGroup: 'rg',
          subscriptionId: 's',
        },
        {
          name: 'ns-v2',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/ns-v2',
          resourceGroup: 'rg',
          subscriptionId: 's',
        },
      ])
    );

    // Call refresh
    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(2);
    expect(result.current.namespaces.map(ns => ns.name)).toContain('ns-v2');
  });

  // -----------------------------------------------------------------------
  // Test 12: stderr alone doesn't break when stdout exists
  // -----------------------------------------------------------------------
  test('stderr with valid stdout does not prevent managed namespace discovery', async () => {
    // Azure CLI often writes warnings to stderr even on success.
    // The hook only throws when stderr is present AND stdout is empty.
    mockRunCommandAsync.mockResolvedValue({
      stdout: JSON.stringify({
        data: [
          {
            id: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/ns1',
            name: 'ns1',
            resourceGroup: 'rg',
            subscriptionId: 's',
            labels: null,
            provisioningState: 'Succeeded',
          },
        ],
      }),
      stderr: 'WARNING: Some deprecation notice',
    });

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Managed namespace should still be discovered despite stderr warnings
    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].name).toBe('ns1');
    expect(result.current.namespaces[0].isManagedNamespace).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Test 13: Non-succeeded provisioning state excluded
  // -----------------------------------------------------------------------
  test('excludes managed namespaces with non-succeeded provisioning state', async () => {
    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          name: 'creating-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/creating-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
          provisioningState: 'Creating',
        },
        {
          name: 'deleting-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/deleting-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
          provisioningState: 'Deleting',
        },
        {
          name: 'ready-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/ready-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
          provisioningState: 'Succeeded',
        },
      ])
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].name).toBe('ready-ns');
  });

  // -----------------------------------------------------------------------
  // Test 14: Windows platform quoting
  // -----------------------------------------------------------------------
  test('wraps query in double quotes on Windows platform', async () => {
    (window as any).desktopApi = { platform: 'win32' };

    mockRunCommandAsync.mockResolvedValue(buildManagedResponse([]));

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Verify runCommandAsync was called with double-quoted query arg
    expect(mockRunCommandAsync).toHaveBeenCalledWith('az', [
      'graph',
      'query',
      '-q',
      expect.stringMatching(/^".*"$/), // starts and ends with double quote
      '--output',
      'json',
    ]);
  });

  test('does not double-quote query on non-Windows platform', async () => {
    // Ensure no desktopApi (or non-Windows)
    delete (window as any).desktopApi;

    mockRunCommandAsync.mockResolvedValue(buildManagedResponse([]));

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Verify the query argument is NOT wrapped in extra quotes
    const queryArg = mockRunCommandAsync.mock.calls[0][1][3];
    expect(queryArg).not.toMatch(/^".*"$/);
    expect(queryArg).toContain('microsoft.containerservice');
  });

  // -----------------------------------------------------------------------
  // Additional edge case tests
  // -----------------------------------------------------------------------

  test('handles empty clusters configuration (null)', async () => {
    mockUseClustersConf.mockReturnValue(null);
    mockRunCommandAsync.mockResolvedValue(buildManagedResponse([]));

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toEqual([]);
  });

  test('filters already-imported labeled namespaces from K8s API results but keeps unlabeled', async () => {
    localStorage.setItem(
      'cluster_settings.my-cluster',
      JSON.stringify({ allowedNamespaces: ['already-imported', 'unlabeled-imported'] })
    );

    mockRunCommandAsync.mockResolvedValue(buildManagedResponse([]));
    mockUseClustersConf.mockReturnValue({ 'my-cluster': {} });
    setupApiListSuccess({
      'my-cluster': [
        buildK8sNamespace('already-imported', {
          'headlamp.dev/project-id': 'already-imported',
          'headlamp.dev/project-managed-by': 'aks-desktop',
        }),
        buildK8sNamespace('unlabeled-imported'),
        buildK8sNamespace('not-imported'),
      ],
    });

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // already-imported filtered (labeled + in allowedNamespaces)
    // unlabeled-imported kept (needs conversion even though in allowedNamespaces)
    // not-imported kept (not in allowedNamespaces)
    expect(result.current.namespaces).toHaveLength(2);
    expect(result.current.namespaces.map(ns => ns.name).sort()).toEqual([
      'not-imported',
      'unlabeled-imported',
    ]);
  });

  test('category assignment for regular namespaces with project labels is needs-import', async () => {
    mockRunCommandAsync.mockResolvedValue(buildManagedResponse([]));
    mockUseClustersConf.mockReturnValue({ 'my-cluster': {} });
    setupApiListSuccess({
      'my-cluster': [
        buildK8sNamespace('labeled-regular', {
          'headlamp.dev/project-id': 'labeled-regular',
          'headlamp.dev/project-managed-by': 'aks-desktop',
        }),
      ],
    });

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].category).toBe('needs-import');
    expect(result.current.namespaces[0].isAksProject).toBe(true);
  });

  test('isAksDesktopProject returns false when only one label is present', async () => {
    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          name: 'partial-label-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/partial-label-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
          labels: {
            'headlamp.dev/project-id': 'partial-label-ns',
            // Missing headlamp.dev/project-managed-by
          },
        },
      ])
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].isAksProject).toBe(false);
    expect(result.current.namespaces[0].category).toBe('needs-conversion');
  });

  test('filters out namespaces with malformed resource IDs (empty cluster name)', async () => {
    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          name: 'orphan-ns',
          clusterId: '/some/random/path',
          resourceGroup: 'rg',
          subscriptionId: 's',
        },
        {
          name: 'valid-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/my-cluster/managedNamespaces/valid-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
        },
      ])
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].name).toBe('valid-ns');
    expect(result.current.namespaces[0].clusterName).toBe('my-cluster');
  });

  test('handles localStorage with invalid JSON gracefully', async () => {
    localStorage.setItem('cluster_settings.my-cluster', 'not-valid-json{{{');

    mockRunCommandAsync.mockResolvedValue(buildManagedResponse([]));
    mockUseClustersConf.mockReturnValue({ 'my-cluster': {} });
    setupApiListSuccess({
      'my-cluster': [buildK8sNamespace('test-ns')],
    });

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should not crash, namespace should appear (isAlreadyImported returns false on error)
    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].name).toBe('test-ns');
  });

  test('filters system namespaces from K8s API results', async () => {
    mockRunCommandAsync.mockResolvedValue(buildManagedResponse([]));
    mockUseClustersConf.mockReturnValue({ 'my-cluster': {} });
    setupApiListSuccess({
      'my-cluster': [
        buildK8sNamespace('kube-system'),
        buildK8sNamespace('default'),
        buildK8sNamespace('user-ns'),
      ],
    });

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].name).toBe('user-ns');
  });

  test('discovers namespaces from multiple registered clusters', async () => {
    mockRunCommandAsync.mockResolvedValue(buildManagedResponse([]));
    mockUseClustersConf.mockReturnValue({ 'cluster-a': {}, 'cluster-b': {} });
    setupApiListSuccess({
      'cluster-a': [buildK8sNamespace('ns-a')],
      'cluster-b': [buildK8sNamespace('ns-b')],
    });

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(2);
    const names = result.current.namespaces.map(ns => ns.name);
    expect(names).toContain('ns-a');
    expect(names).toContain('ns-b');
    expect(result.current.namespaces.find(ns => ns.name === 'ns-a')!.clusterName).toBe('cluster-a');
    expect(result.current.namespaces.find(ns => ns.name === 'ns-b')!.clusterName).toBe('cluster-b');
  });

  test('provisioningState filter is case-insensitive (accepts "succeeded")', async () => {
    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          name: 'lowercase-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/lowercase-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
          provisioningState: 'succeeded',
        },
      ])
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].name).toBe('lowercase-ns');
  });

  test('stderr-only response with no stdout causes managed path to fail gracefully', async () => {
    mockRunCommandAsync.mockResolvedValue({
      stdout: '',
      stderr: 'ERROR: Please run az login',
    });

    mockUseClustersConf.mockReturnValue({ c: {} });
    setupApiListSuccess({
      c: [buildK8sNamespace('fallback')],
    });

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Managed path threw due to stderr, but regular discovery continues
    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].name).toBe('fallback');
  });

  test('extracts namespace name from Resource Graph parent/child format', async () => {
    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          // Azure Resource Graph may return nested names as "clusterName/namespaceName"
          name: 'my-cluster/app-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/my-cluster/managedNamespaces/app-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
        },
      ])
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    // Should extract just the namespace name, not "my-cluster/app-ns"
    expect(result.current.namespaces[0].name).toBe('app-ns');
    expect(result.current.namespaces[0].clusterName).toBe('my-cluster');
  });

  test('handles Resource Graph name without parent prefix', async () => {
    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          name: 'simple-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/c/managedNamespaces/simple-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
        },
      ])
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].name).toBe('simple-ns');
  });

  test('filters system namespaces even with parent/child name format', async () => {
    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          name: 'my-cluster/kube-system',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/my-cluster/managedNamespaces/kube-system',
          resourceGroup: 'rg',
          subscriptionId: 's',
        },
        {
          name: 'my-cluster/user-ns',
          clusterId:
            '/subscriptions/s/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/my-cluster/managedNamespaces/user-ns',
          resourceGroup: 'rg',
          subscriptionId: 's',
        },
      ])
    );

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    expect(result.current.namespaces[0].name).toBe('user-ns');
  });

  test('regular namespaces on managed clusters are not enriched with Azure metadata', async () => {
    // Resource Graph returns one managed namespace on cluster-a
    mockRunCommandAsync.mockResolvedValue(
      buildManagedResponse([
        {
          name: 'managed-ns',
          clusterId:
            '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ContainerService/managedClusters/cluster-a/managedNamespaces/managed-ns',
          resourceGroup: 'rg-1',
          subscriptionId: 'sub-1',
        },
      ])
    );

    // K8s API returns a different namespace on the same cluster (genuinely regular,
    // not in Resource Graph). It should NOT be enriched with Azure metadata because
    // it's not a managed namespace — using the ARM API to update its labels would fail.
    mockUseClustersConf.mockReturnValue({ 'cluster-a': {} });
    setupApiListSuccess({
      'cluster-a': [buildK8sNamespace('regular-ns')],
    });

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(2);

    const regularNs = result.current.namespaces.find(ns => ns.name === 'regular-ns');
    expect(regularNs).toBeDefined();
    expect(regularNs!.resourceGroup).toBe('');
    expect(regularNs!.subscriptionId).toBe('');
    expect(regularNs!.isManagedNamespace).toBe(false);
  });

  test('does not enrich regular namespaces on clusters without managed namespaces', async () => {
    // No managed namespaces
    mockRunCommandAsync.mockResolvedValue(buildManagedResponse([]));

    mockUseClustersConf.mockReturnValue({ 'standalone-cluster': {} });
    setupApiListSuccess({
      'standalone-cluster': [buildK8sNamespace('plain-ns')],
    });

    const { result } = renderHook(() => useNamespaceDiscovery());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.namespaces).toHaveLength(1);
    const ns = result.current.namespaces[0];
    expect(ns.name).toBe('plain-ns');
    expect(ns.resourceGroup).toBe('');
    expect(ns.subscriptionId).toBe('');
    expect(ns.isManagedNamespace).toBe(false);
  });
});
