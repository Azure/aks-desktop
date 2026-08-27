// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockClusterRequest = vi.hoisted(() => vi.fn());
const mockRequest = vi.hoisted(() => vi.fn());
const mockStartClusterProxy = vi.hoisted(() => vi.fn());
const mockRunCommandAsync = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: {
    clusterRequest: mockClusterRequest,
    request: mockRequest,
  },
}));

// `getClusterCurrentState` runs `az rest` via the shared command runner; mock
// it so verification tests can simulate Azure states.
vi.mock('../shared/runCommandAsync', () => ({
  runCommandAsync: mockRunCommandAsync,
}));

import {
  azurePortalClusterUrl,
  checkClusterAccessible,
  checkClusterReachable,
  getClusterCurrentState,
  isClusterInKubeconfig,
  startProxy,
  verifyAksHybridEdgeCluster,
} from './aksHybridEdgeProxy';

const targetA = { subscriptionId: 'sub-a', resourceGroup: 'rg-a', clusterName: 'cluster-a' };

describe('aksHybridEdgeProxy — start/stop delegate to the app layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartClusterProxy.mockResolvedValue({ success: true });
    (window as any).desktopApi = { startClusterProxy: mockStartClusterProxy };
  });

  afterEach(() => {
    delete (window as any).desktopApi;
  });

  test('startProxy sends a cluster-keyed start intent to the main process', async () => {
    const res = await startProxy(targetA);
    expect(res.success).toBe(true);
    expect(mockStartClusterProxy).toHaveBeenCalledWith({
      cluster: 'cluster-a',
      subscriptionId: 'sub-a',
      resourceGroup: 'rg-a',
    });
  });

  test('startProxy fails cleanly when the desktop bridge is unavailable', async () => {
    delete (window as any).desktopApi;
    const res = await startProxy(targetA);
    expect(res.success).toBe(false);
    expect(mockStartClusterProxy).not.toHaveBeenCalled();
  });

  test('startProxy returns an immediate main-process failure', async () => {
    mockStartClusterProxy.mockResolvedValue({ success: false, error: 'spawn az ENOENT' });

    await expect(startProxy(targetA)).resolves.toEqual({
      success: false,
      error: 'spawn az ENOENT',
    });
  });
});

describe('aksHybridEdgeProxy — reachability & verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('checkClusterReachable probes an unprivileged endpoint so RBAC cannot mask a live proxy', async () => {
    // A permission-scoped probe returns 403 on an Arc cluster granting only
    // namespace-scoped access, which would report a working proxy as down.
    mockClusterRequest.mockResolvedValue({ gitVersion: 'v1.34.3' });
    const res = await checkClusterReachable('cluster-a');
    expect(res.success).toBe(true);
    expect(mockClusterRequest).toHaveBeenCalledWith(
      '/version',
      expect.objectContaining({ cluster: 'cluster-a' })
    );
  });

  test('checkClusterReachable reports failure when the API rejects', async () => {
    mockClusterRequest.mockRejectedValue(new Error('connection refused'));
    const res = await checkClusterReachable('cluster-a');
    expect(res.success).toBe(false);
    expect(res.error).toContain('connection refused');
  });

  test('checkClusterReachable aborts an active API probe', async () => {
    const controller = new AbortController();
    mockClusterRequest.mockImplementation(
      (_path, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          });
        })
    );

    const probe = checkClusterReachable('cluster-a', controller.signal);
    controller.abort();

    await expect(probe).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('checkClusterAccessible returns accessible on the first successful probe', async () => {
    mockClusterRequest.mockResolvedValue({ items: [] });
    const res = await checkClusterAccessible('cluster-a');
    expect(res.accessible).toBe(true);
    // Short-circuits — no retries once a probe succeeds.
    expect(mockClusterRequest).toHaveBeenCalledTimes(1);
  });

  test('checkClusterAccessible retries and succeeds if a later probe responds', async () => {
    mockClusterRequest
      .mockRejectedValueOnce(new Error('no route to host'))
      .mockResolvedValueOnce({ items: [] });
    const res = await checkClusterAccessible('cluster-a');
    expect(res.accessible).toBe(true);
    expect(mockClusterRequest).toHaveBeenCalledTimes(2);
  });

  test('checkClusterAccessible marks inaccessible after 3 failed probes', async () => {
    mockClusterRequest.mockRejectedValue(new Error('connection refused'));
    const res = await checkClusterAccessible('cluster-a');
    expect(res.accessible).toBe(false);
    expect(res.error).toContain('connection refused');
    expect(mockClusterRequest).toHaveBeenCalledTimes(3);
  });

  test('checkClusterAccessible honours a custom attempt count', async () => {
    mockClusterRequest.mockRejectedValue(new Error('down'));
    const res = await checkClusterAccessible('cluster-a', 2);
    expect(res.accessible).toBe(false);
    expect(mockClusterRequest).toHaveBeenCalledTimes(2);
  });

  test('isClusterInKubeconfig checks Headlamp /config (array of clusters) for the context', async () => {
    mockRequest.mockResolvedValue({ clusters: [{ name: 'cluster-a' }, { name: 'other' }] });
    expect(await isClusterInKubeconfig('cluster-a')).toBe(true);
    expect(await isClusterInKubeconfig('missing')).toBe(false);
  });

  describe('verifyAksHybridEdgeCluster', () => {
    test('succeeds once the context is loaded and the cluster is reachable', async () => {
      mockRequest.mockResolvedValue({ clusters: [{ name: 'cluster-a' }] });
      mockClusterRequest.mockResolvedValue({ items: [] });

      const res = await verifyAksHybridEdgeCluster('cluster-a', { timeoutMs: 100, intervalMs: 5 });
      expect(res.success).toBe(true);
      expect(res.inKubeconfig).toBe(true);
      expect(res.reachable).toBe(true);
    });

    test('fails (not in kubeconfig) when /config never lists the context', async () => {
      mockRequest.mockResolvedValue({ clusters: [] });
      mockClusterRequest.mockRejectedValue(new Error('cluster not found'));

      const res = await verifyAksHybridEdgeCluster('cluster-a', { timeoutMs: 30, intervalMs: 5 });
      expect(res.success).toBe(false);
      expect(res.inKubeconfig).toBe(false);
      // Phase 1 gates Phase 2: no API probe until the context is loaded.
      expect(mockClusterRequest).not.toHaveBeenCalled();
    });

    test('aborts while waiting for the kubeconfig context', async () => {
      const controller = new AbortController();
      mockRequest.mockResolvedValue({ clusters: [] });

      const verification = verifyAksHybridEdgeCluster('cluster-a', {
        intervalMs: 10_000,
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(mockRequest).toHaveBeenCalledOnce());
      controller.abort();

      await expect(verification).rejects.toMatchObject({ name: 'AbortError' });
      expect(mockRequest).toHaveBeenCalledOnce();
      expect(mockClusterRequest).not.toHaveBeenCalled();
    });

    test('fails (in kubeconfig but unreachable) when the API never answers', async () => {
      mockRequest.mockResolvedValue({ clusters: [{ name: 'cluster-a' }] });
      mockClusterRequest.mockRejectedValue(new Error('timeout'));

      const res = await verifyAksHybridEdgeCluster('cluster-a', { timeoutMs: 30, intervalMs: 5 });
      expect(res.success).toBe(false);
      expect(res.inKubeconfig).toBe(true);
      expect(res.reachable).toBe(false);
    });

    test('explains a Failed cluster when a target is supplied and it is unreachable', async () => {
      mockRequest.mockResolvedValue({ clusters: [{ name: 'cluster-a' }] });
      mockClusterRequest.mockRejectedValue(new Error('timeout'));
      // az rest ... --query properties.status -o json → Failed currentState + reason
      mockRunCommandAsync.mockResolvedValue({
        stdout: JSON.stringify({
          currentState: 'Failed',
          errorMessage: 'Timed out waiting for target cluster to be ready.',
        }),
        stderr: '',
      });

      const res = await verifyAksHybridEdgeCluster('cluster-a', {
        timeoutMs: 30,
        intervalMs: 5,
        target: { subscriptionId: 'sub-a', resourceGroup: 'rg-a' },
      });
      expect(res.success).toBe(false);
      expect(res.reachable).toBe(false);
      expect(res.currentState).toBe('Failed');
      expect(res.error).toContain('Failed');
      // Azure's own reason is surfaced verbatim to the user.
      expect(res.error).toContain('Timed out waiting for target cluster to be ready.');
      expect(res.error).toContain('Azure portal');
    });
  });

  describe('getClusterCurrentState', () => {
    test('returns the currentState and errorMessage from the provisioned instance', async () => {
      mockRunCommandAsync.mockResolvedValue({
        stdout: JSON.stringify({ currentState: 'Failed', errorMessage: 'not reachable' }),
        stderr: '',
      });
      const health = await getClusterCurrentState({
        subscriptionId: 'sub-a',
        resourceGroup: 'rg-a',
        clusterName: 'cluster-a',
      });
      expect(health.currentState).toBe('Failed');
      expect(health.errorMessage).toBe('not reachable');
    });

    test('returns null currentState when the az command errors (e.g. generic Arc cluster 404)', async () => {
      mockRunCommandAsync.mockResolvedValue({ stdout: '', stderr: 'ERROR: not found' });
      const health = await getClusterCurrentState({
        subscriptionId: 'sub-a',
        resourceGroup: 'rg-a',
        clusterName: 'cluster-a',
      });
      expect(health.currentState).toBeNull();
    });
  });

  describe('azurePortalClusterUrl', () => {
    test('builds a connectedClusters overview deep link', () => {
      const url = azurePortalClusterUrl({
        subscriptionId: 'sub-a',
        resourceGroup: 'rg-a',
        clusterName: 'cluster-a',
      });
      expect(url).toContain(
        '/subscriptions/sub-a/resourceGroups/rg-a/providers/Microsoft.Kubernetes/connectedClusters/cluster-a/overview'
      );
      expect(url.startsWith('https://portal.azure.com/')).toBe(true);
    });
  });
});
