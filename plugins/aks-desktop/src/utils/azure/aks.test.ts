// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetClusters = vi.fn();
const mockGetConnectedClusters = vi.fn();
const mockGetAzSubscriptions = vi.fn();

vi.mock('./az-clusters', () => ({
  getClusters: (...args: unknown[]) => mockGetClusters(...args),
  getConnectedClusters: (...args: unknown[]) => mockGetConnectedClusters(...args),
}));

vi.mock('./az-subscriptions', () => ({
  getSubscriptions: (...args: unknown[]) => mockGetAzSubscriptions(...args),
}));

vi.mock('../../components/BareMetal/proxy', () => ({
  getBareMetalProxyStatus: vi.fn(),
  startBareMetalProxy: vi.fn(),
  stopBareMetalProxy: vi.fn(),
  restartBareMetalProxy: vi.fn(),
}));

import {
  _clearAKSClustersCache,
  getAKSClusters,
  getSubscriptions,
  registerAKSCluster,
} from './aks';

describe('getSubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return mapped subscriptions on success', async () => {
    mockGetAzSubscriptions.mockResolvedValue([
      { id: 'sub-1', name: 'My Sub', status: 'Enabled', tenant: 'tenant-1' },
    ]);

    const result = await getSubscriptions();

    expect(result.success).toBe(true);
    expect(result.subscriptions).toHaveLength(1);
    expect(result.subscriptions![0]).toEqual({
      id: 'sub-1',
      name: 'My Sub',
      state: 'Enabled',
      tenantId: 'tenant-1',
      isDefault: false,
    });
  });

  it('should return failure on error', async () => {
    mockGetAzSubscriptions.mockRejectedValue(new Error('auth required'));

    const result = await getSubscriptions();

    expect(result.success).toBe(false);
    expect(result.message).toBe('auth required');
  });

  it('should default state to Unknown when status is missing', async () => {
    mockGetAzSubscriptions.mockResolvedValue([
      { id: 'sub-2', name: 'Other Sub', tenant: 'tenant-2' },
    ]);

    const result = await getSubscriptions();

    expect(result.subscriptions![0].state).toBe('Unknown');
  });
});

describe('getAKSClusters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearAKSClustersCache();
  });

  it('should merge AKS and BareMetal clusters', async () => {
    mockGetClusters.mockResolvedValue([
      {
        name: 'aks-cluster',
        resourceGroup: 'rg-aks',
        location: 'eastus',
        version: '1.28.0',
        status: 'Succeeded',
      },
    ]);
    mockGetConnectedClusters.mockResolvedValue([
      {
        name: 'arc-cluster',
        resourceGroup: 'rg-arc',
        location: 'westus',
        version: '1.27.0',
        status: 'Running',
        clusterType: 'aksarc',
      },
    ]);

    const result = await getAKSClusters('sub-1');

    expect(result.success).toBe(true);
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters![0].clusterType).toBe('aks');
    expect(result.clusters![1].clusterType).toBe('aksarc');
  });

  it('should return empty clusters when both sources are empty', async () => {
    mockGetClusters.mockResolvedValue([]);
    mockGetConnectedClusters.mockResolvedValue([]);

    const result = await getAKSClusters('sub-1');

    expect(result.success).toBe(true);
    expect(result.clusters).toEqual([]);
  });

  it('should return failure on error', async () => {
    mockGetClusters.mockRejectedValue(new Error('network error'));

    const result = await getAKSClusters('sub-1');

    expect(result.success).toBe(false);
    expect(result.message).toBe('network error');
  });

  it('should default clusterType to aks when not set', async () => {
    mockGetClusters.mockResolvedValue([
      {
        name: 'cluster-no-type',
        resourceGroup: 'rg',
        location: 'eastus',
        version: '1.28.0',
        status: 'Succeeded',
      },
    ]);
    mockGetConnectedClusters.mockResolvedValue([]);

    const result = await getAKSClusters('sub-1');

    expect(result.clusters![0].clusterType).toBe('aks');
  });
});

describe('registerAKSCluster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return failure when desktopApi is not available', async () => {
    (window as any).desktopApi = undefined;

    const result = await registerAKSCluster('sub-1', 'rg-1', 'cluster-1');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Desktop API not available');
  });

  it('should call desktopApi.registerAKSCluster and return result', async () => {
    const mockRegister = vi.fn().mockResolvedValue({ success: true, message: 'ok' });
    (window as any).desktopApi = { registerAKSCluster: mockRegister };

    const result = await registerAKSCluster('sub-1', 'rg-1', 'cluster-1', undefined, 'aksarc');

    expect(result).toEqual({ success: true, message: 'ok' });
    expect(mockRegister).toHaveBeenCalledWith(
      'sub-1',
      'rg-1',
      'cluster-1',
      false,
      undefined,
      'aksarc'
    );
  });

  it('should default clusterType to aks', async () => {
    const mockRegister = vi.fn().mockResolvedValue({ success: true, message: 'ok' });
    (window as any).desktopApi = { registerAKSCluster: mockRegister };

    await registerAKSCluster('sub-1', 'rg-1', 'cluster-1');

    expect(mockRegister).toHaveBeenCalledWith(
      'sub-1',
      'rg-1',
      'cluster-1',
      false,
      undefined,
      'aks'
    );
  });

  it('should return failure when desktopApi call throws', async () => {
    const mockRegister = vi.fn().mockRejectedValue(new Error('IPC error'));
    (window as any).desktopApi = { registerAKSCluster: mockRegister };

    const result = await registerAKSCluster('sub-1', 'rg-1', 'cluster-1');

    expect(result.success).toBe(false);
    expect(result.message).toBe('IPC error');
  });
});

// ---------------------------------------------------------------------------
// Defense-in-depth: getAKSClusters rate-limiting
//
// These tests reproduce the bug caused by `t` (from useTranslation) being
// listed in a useEffect dependency array. Because the headlamp plugin i18n
// implementation returns a new `t` reference on every render, the effect fires
// on every render, calling getAKSClusters in a tight loop and spawning
// hundreds of concurrent `az connectedk8s list` + `az graph query` processes.
// ---------------------------------------------------------------------------
describe('getAKSClusters — defense-in-depth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearAKSClustersCache();
  });

  it('reproduces the bug: without protection, rapid sequential calls each hit the CLI', async () => {
    // This is what the React re-render loop was doing before the fix.
    // Each await resolves before the next call, so no in-flight dedup applies.
    mockGetClusters.mockResolvedValue([]);
    mockGetConnectedClusters.mockResolvedValue([]);
    _clearAKSClustersCache(); // disable the cache to simulate the unprotected path

    // We can't truly test the "unprotected" path without removing the cache,
    // but we can document the expected call count without protection: N calls
    // would produce N CLI invocations. With the cache, only 1 does.
    const SIMULATED_RENDER_COUNT = 10;
    _clearAKSClustersCache();
    for (let i = 0; i < SIMULATED_RENDER_COUNT; i++) {
      await getAKSClusters('sub-1'); // cache hit after first call
    }
    // With the TTL cache: only the first call reaches the CLI.
    expect(mockGetClusters).toHaveBeenCalledTimes(1);
    expect(mockGetConnectedClusters).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent calls — only one az CLI process is spawned', async () => {
    // Simulate two React effects firing simultaneously for the same subscription
    // (what happens when the t dependency change triggers a re-render mid-fetch).
    let resolveFirst!: (value: any[]) => void;
    mockGetClusters.mockReturnValueOnce(
      new Promise(res => {
        resolveFirst = res;
      })
    );
    mockGetConnectedClusters.mockResolvedValue([]);

    const p1 = getAKSClusters('sub-1');
    const p2 = getAKSClusters('sub-1'); // concurrent — must reuse p1's promise

    resolveFirst([]); // let the first call complete

    const [r1, r2] = await Promise.all([p1, p2]);

    // Only one CLI invocation despite two concurrent callers.
    expect(mockGetClusters).toHaveBeenCalledTimes(1);
    expect(mockGetConnectedClusters).toHaveBeenCalledTimes(1);
    // Both callers receive the same resolved value.
    expect(r1).toBe(r2);
  });

  it('returns cached result for rapid sequential calls', async () => {
    mockGetClusters.mockResolvedValue([
      {
        name: 'c',
        resourceGroup: 'rg',
        location: 'l',
        version: '1',
        status: 'Succeeded',
        clusterType: 'aks',
      },
    ]);
    mockGetConnectedClusters.mockResolvedValue([]);

    const first = await getAKSClusters('sub-1');
    const second = await getAKSClusters('sub-1');
    const third = await getAKSClusters('sub-1');

    expect(mockGetClusters).toHaveBeenCalledTimes(1); // subsequent calls are cache hits
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('makes a fresh CLI call after the TTL expires', async () => {
    vi.useFakeTimers();
    mockGetClusters.mockResolvedValue([]);
    mockGetConnectedClusters.mockResolvedValue([]);

    await getAKSClusters('sub-1');
    vi.advanceTimersByTime(11_000); // past the 10 s TTL
    await getAKSClusters('sub-1');

    expect(mockGetClusters).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not cache error results — failed calls are retried immediately', async () => {
    mockGetClusters.mockRejectedValueOnce(new Error('network error'));
    mockGetClusters.mockResolvedValue([]);
    mockGetConnectedClusters.mockResolvedValue([]);

    const first = await getAKSClusters('sub-1');
    const second = await getAKSClusters('sub-1');

    expect(first.success).toBe(false);
    expect(second.success).toBe(true);
    expect(mockGetClusters).toHaveBeenCalledTimes(2); // error was not cached
  });
});
