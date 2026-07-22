// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockCheckClusterReachable = vi.hoisted(() => vi.fn());
const mockStartProxy = vi.hoisted(() => vi.fn());
const mockStopProxy = vi.hoisted(() => vi.fn());
const mockVerify = vi.hoisted(() => vi.fn());
const mockGetClusterSettings = vi.hoisted(() => vi.fn());
const mockMarkAppearance = vi.hoisted(() => vi.fn());

vi.mock('../../utils/azure/aksHybridEdgeProxy', () => ({
  checkClusterReachable: mockCheckClusterReachable,
  startProxy: mockStartProxy,
  stopProxy: mockStopProxy,
  verifyAksHybridEdgeCluster: mockVerify,
}));

vi.mock('../../utils/shared/clusterSettings', () => ({
  getClusterSettings: mockGetClusterSettings,
  markAksHybridEdgeAppearance: mockMarkAppearance,
}));

import { aksHybridEdgePreOpenHook, looksLikeArcProxiedCluster } from './aksHybridEdgePreOpen';

// A real `az connectedk8s proxy` kubeconfig server URL.
const PROXY_SERVER =
  'https://127.0.0.1:47011/proxies/b7aaf9dd06bfe352324393a15dd45da70bc8277cda39814daa7911a56a65b481';

describe('looksLikeArcProxiedCluster', () => {
  test('true for a loopback host with the /proxies/<token> path (any port)', () => {
    expect(looksLikeArcProxiedCluster({ server: PROXY_SERVER })).toBe(true);
    expect(
      looksLikeArcProxiedCluster({ server: 'https://localhost:47011/proxies/deadbeefdeadbeef' })
    ).toBe(true);
    // Custom --port still matches — the path is the signature, not the port.
    expect(
      looksLikeArcProxiedCluster({ server: 'https://127.0.0.1:8080/proxies/deadbeefdeadbeef' })
    ).toBe(true);
  });

  test('false for a loopback host without the /proxies path (e.g. minikube/kind)', () => {
    expect(looksLikeArcProxiedCluster({ server: 'https://127.0.0.1:47011' })).toBe(false);
    expect(looksLikeArcProxiedCluster({ server: 'https://127.0.0.1:6443' })).toBe(false);
    expect(looksLikeArcProxiedCluster({ server: 'https://127.0.0.1:8443/api' })).toBe(false);
  });

  test('false for a non-loopback host even with the /proxies path', () => {
    expect(
      looksLikeArcProxiedCluster({ server: 'https://10.0.0.5:47011/proxies/deadbeefdeadbeef' })
    ).toBe(false);
  });

  test('false for missing / non-string / unparseable server', () => {
    expect(looksLikeArcProxiedCluster({})).toBe(false);
    expect(looksLikeArcProxiedCluster(null)).toBe(false);
    expect(looksLikeArcProxiedCluster(undefined)).toBe(false);
    expect(looksLikeArcProxiedCluster({ server: 42 })).toBe(false);
    expect(looksLikeArcProxiedCluster({ server: 'not a url' })).toBe(false);
  });
});

describe('aksHybridEdgePreOpenHook — manually-added cluster handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('no-op for a genuine non-Arc cluster (not proxy-looking)', async () => {
    mockGetClusterSettings.mockReturnValue({}); // no clusterType
    await expect(
      aksHybridEdgePreOpenHook({
        cluster: 'kind-dev',
        clusterConf: { server: 'https://127.0.0.1:6443' },
      })
    ).resolves.toBeUndefined();
    expect(mockCheckClusterReachable).not.toHaveBeenCalled();
    expect(mockStartProxy).not.toHaveBeenCalled();
  });

  test('guides the user when a proxy-looking cluster is unregistered and unreachable', async () => {
    mockGetClusterSettings.mockReturnValue({}); // added manually — no metadata
    mockCheckClusterReachable.mockResolvedValue({ success: false });

    await expect(
      aksHybridEdgePreOpenHook({ cluster: 'manual-arc', clusterConf: { server: PROXY_SERVER } })
    ).rejects.toThrow(/Register it via "Register AKS cluster"/);
    expect(mockStartProxy).not.toHaveBeenCalled();
  });

  test('lets a proxy-looking cluster open if it is already reachable (user-run proxy)', async () => {
    mockGetClusterSettings.mockReturnValue({});
    mockCheckClusterReachable.mockResolvedValue({ success: true });

    await expect(
      aksHybridEdgePreOpenHook({ cluster: 'manual-arc-up', clusterConf: { server: PROXY_SERVER } })
    ).resolves.toBeUndefined();
    expect(mockStartProxy).not.toHaveBeenCalled();
  });
});
