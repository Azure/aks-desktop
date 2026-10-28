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

// Retain the command boundary to prove health requests no longer execute az rest.
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
import { azCliCredential, AzTokenError } from './az-token';

const targetA = { subscriptionId: 'sub-a', resourceGroup: 'rg-a', clusterName: 'cluster-a' };
const mockFetch = vi.fn<typeof fetch>();

function healthResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockRunCommandAsync.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  vi.spyOn(azCliCredential, 'getToken').mockResolvedValue({
    token: 'test-arm-token',
    expiresOnTimestamp: Date.now() + 3_600_000,
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('aksHybridEdgeProxy — injected app capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartClusterProxy.mockResolvedValue({ success: true });
    vi.stubGlobal('startClusterProxy', mockStartClusterProxy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    vi.stubGlobal('startClusterProxy', undefined);
    const res = await startProxy(targetA);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Desktop proxy capability is not available.');
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
      mockFetch.mockResolvedValue(
        healthResponse({
          properties: {
            provisioningState: 'Succeeded',
            connectivityStatus: 'Connected',
            status: {
              currentState: 'Failed',
              errorMessage: 'Timed out waiting for target cluster to be ready.',
            },
          },
        })
      );

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

    test('does not query Azure health when the Kubernetes API is reachable', async () => {
      mockRequest.mockResolvedValue({ clusters: [{ name: targetA.clusterName }] });
      mockClusterRequest.mockResolvedValue({ gitVersion: 'v1.34.3' });

      await expect(
        verifyAksHybridEdgeCluster(targetA.clusterName, {
          target: targetA,
          timeoutMs: 0,
        })
      ).resolves.toEqual({ success: true, inKubeconfig: true, reachable: true });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(azCliCredential.getToken).not.toHaveBeenCalled();
    });

    test.each([200, 404, 403])(
      'preserves the reachability error without inventing unhealthy state (HTTP %s)',
      async status => {
        mockRequest.mockResolvedValue({ clusters: [{ name: targetA.clusterName }] });
        mockClusterRequest.mockRejectedValue(new Error('connection refused'));
        mockFetch.mockResolvedValue(
          healthResponse(
            status === 200
              ? {
                  properties: {
                    provisioningState: 'Failed',
                    connectivityStatus: 'Disconnected',
                    status: { currentState: 'Succeeded' },
                  },
                }
              : { error: { code: status === 404 ? 'ResourceNotFound' : 'AuthorizationFailed' } },
            status
          )
        );

        const result = await verifyAksHybridEdgeCluster(targetA.clusterName, {
          target: targetA,
          timeoutMs: 0,
        });

        expect(result.success).toBe(false);
        expect(result.reachable).toBe(false);
        expect(result.error).toBe('connection refused');
        expect(result.currentState).toBe(status === 200 ? 'Succeeded' : undefined);
        expect(console.warn).toHaveBeenCalledTimes(status === 403 ? 1 : 0);
        expect(mockRunCommandAsync).not.toHaveBeenCalled();
      }
    );
  });

  describe('getClusterCurrentState', () => {
    afterEach(() => {
      expect(mockRunCommandAsync).not.toHaveBeenCalled();
    });

    test('returns the currentState and errorMessage from the provisioned instance', async () => {
      mockFetch.mockResolvedValue(
        healthResponse({
          properties: { status: { currentState: 'Failed', errorMessage: 'not reachable' } },
        })
      );
      const health = await getClusterCurrentState({
        subscriptionId: 'sub-a',
        resourceGroup: 'rg-a',
        clusterName: 'cluster-a',
      });
      expect(health.currentState).toBe('Failed');
      expect(health.errorMessage).toBe('not reachable');
    });

    test('uses authenticated HTTP with encoded path segments and the pinned API version', async () => {
      mockFetch.mockResolvedValue(
        healthResponse({
          properties: { provisioningState: 'Failed', status: { currentState: 'Succeeded' } },
        })
      );
      const health = await getClusterCurrentState({
        subscriptionId: 'sub-a',
        resourceGroup: 'équipe (#1)',
        clusterName: 'cluster /?#',
      });

      expect(health.currentState).toBe('Succeeded');
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toBe(
        'https://management.azure.com/subscriptions/sub-a/resourceGroups/%C3%A9quipe%20(%231)' +
          '/providers/Microsoft.Kubernetes/connectedClusters/cluster%20%2F%3F%23' +
          '/providers/Microsoft.HybridContainerService/provisionedClusterInstances/default?api-version=2024-01-01'
      );
      expect(init?.method).toBe('GET');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-arm-token');
      expect(azCliCredential.getToken).toHaveBeenCalledWith(
        'https://management.azure.com/.default',
        expect.objectContaining({ abortSignal: expect.any(AbortSignal) })
      );
    });

    test.each([
      {},
      { properties: {} },
      { properties: { status: {} } },
      { properties: { status: null } },
      { properties: { status: { currentState: null } } },
      { properties: { status: { currentState: '' } } },
      { properties: { provisioningState: 'Succeeded', connectivityStatus: 'Connected' } },
    ])('returns unknown health for missing observed status (%j)', async body => {
      mockFetch.mockResolvedValue(healthResponse(body));
      expect((await getClusterCurrentState(targetA)).currentState).toBeNull();
      expect(console.warn).not.toHaveBeenCalled();
    });

    test('treats a bodyless response as unknown observed health', async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
      expect((await getClusterCurrentState(targetA)).currentState).toBeNull();
      expect(console.warn).not.toHaveBeenCalled();
    });

    test('treats an expected 404 as unknown health without a warning', async () => {
      mockFetch.mockResolvedValue(
        healthResponse(
          {
            error: { code: 'ResourceNotFound', message: 'No provisioned instance' },
          },
          404
        )
      );
      await expect(getClusterCurrentState(targetA)).resolves.toEqual({ currentState: null });
      expect(console.warn).not.toHaveBeenCalled();
    });

    test.each([401, 403, 500])(
      'diagnoses HTTP %s without changing unknown health into a failed cluster',
      async status => {
        mockFetch.mockImplementation(async () =>
          healthResponse(
            {
              error: { code: 'LookupFailed', message: 'Health lookup denied or unavailable' },
            },
            status,
            { 'retry-after': '0', 'x-ms-request-id': 'health-request' }
          )
        );

        await expect(getClusterCurrentState(targetA)).resolves.toEqual({ currentState: null });

        expect(console.warn).toHaveBeenCalledOnce();
        const diagnostic = vi.mocked(console.warn).mock.calls[0].join(' ');
        expect(diagnostic).toContain(`HTTP ${status}`);
        expect(diagnostic).toContain('health-request');
        expect(diagnostic).not.toContain('test-arm-token');
        expect(mockFetch).toHaveBeenCalledTimes(status === 500 ? 4 : 1);
      }
    );

    test('diagnoses token acquisition failures without fetching a resource', async () => {
      vi.mocked(azCliCredential.getToken).mockRejectedValue(
        new AzTokenError('Azure login required', true)
      );
      await expect(getClusterCurrentState(targetA)).resolves.toEqual({ currentState: null });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Azure login required')
      );
    });

    test('diagnoses malformed JSON without exposing response content', async () => {
      mockFetch.mockResolvedValue(new Response('{ invalid secret-response'));
      await expect(getClusterCurrentState(targetA)).resolves.toEqual({ currentState: null });
      expect(console.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Malformed JSON')
      );
      expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).not.toContain('secret-response');
    });

    test.each([
      [],
      'invalid',
      { properties: [] },
      { properties: { status: [] } },
      { properties: { status: { currentState: 42 } } },
      { properties: { status: { currentState: 'Failed', errorMessage: {} } } },
    ])(
      'diagnoses invalid health shapes rather than accepting a false runtime state (%j)',
      async body => {
        mockFetch.mockResolvedValue(healthResponse(body));
        await expect(getClusterCurrentState(targetA)).resolves.toEqual({ currentState: null });
        expect(console.warn).toHaveBeenCalledWith(
          expect.any(String),
          expect.stringContaining('Malformed cluster runtime health response')
        );
      }
    );

    test('diagnoses an exhausted transport failure without leaking connection details', async () => {
      mockFetch.mockRejectedValue(new Error('private network failure'));
      vi.useFakeTimers();
      const pending = getClusterCurrentState(targetA);
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toEqual({ currentState: null });
      expect(console.warn).toHaveBeenCalledOnce();
      expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).not.toContain(
        'private network failure'
      );
    });

    test('does not mistake an unrelated error with a status property for an expected Azure 404', async () => {
      vi.mocked(azCliCredential.getToken).mockRejectedValue(
        Object.assign(new Error('Credential lookup failed'), { status: 404 })
      );
      await expect(getClusterCurrentState(targetA)).resolves.toEqual({ currentState: null });
      expect(console.warn).toHaveBeenCalledOnce();
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
