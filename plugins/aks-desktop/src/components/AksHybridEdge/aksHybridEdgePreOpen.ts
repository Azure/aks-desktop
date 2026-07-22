// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  checkClusterReachable,
  startProxy,
  stopProxy,
  verifyAksHybridEdgeCluster,
} from '../../utils/azure/aksHybridEdgeProxy';
import {
  getClusterSettings,
  markAksHybridEdgeAppearance,
} from '../../utils/shared/clusterSettings';

/**
 * Path signature of an `az connectedk8s proxy` server URL. The proxy points the
 * kubeconfig context at a loopback URL of the form
 * `https://127.0.0.1:<port>/proxies/<hex-token>` — the `/proxies/<token>` path
 * is the distinctive fingerprint (unlike the port, it doesn't change with a
 * custom `--port`).
 */
const ARC_PROXY_PATH_RE = /^\/proxies\/[0-9a-f]{16,}\/?$/i;

/**
 * Best-effort detection of an Arc-proxied cluster from its kubeconfig server
 * URL: a loopback host whose path is the `az connectedk8s proxy` `/proxies/<token>`
 * signature. Used to recognise an AKS Hybrid & Edge cluster that was **added
 * manually** (so it carries no plugin metadata — no `clusterType`/subscription/
 * resource group) and guide the user, instead of silently failing to connect.
 *
 * @param clusterConf - The cluster's config (from Headlamp's `/config`), which
 *   carries the kubeconfig `server` URL. Loosely typed by the extension point.
 */
export function looksLikeArcProxiedCluster(clusterConf: unknown): boolean {
  const server = (clusterConf as { server?: unknown } | null | undefined)?.server;
  if (typeof server !== 'string' || !server) {
    return false;
  }
  try {
    const url = new URL(server);
    const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    return isLoopback && ARC_PROXY_PATH_RE.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Pre-open hook (registered via `registerClusterProviderPreOpen`) that
 * transparently connects an AKS Hybrid & Edge (Arc-connected) cluster when the
 * user opens it.
 *
 * For clusters this plugin does not own (no `aksarc` marker) it resolves
 * immediately — unless the cluster looks Arc-proxied but was added manually
 * (no plugin metadata) and isn't reachable, in which case it throws a message
 * guiding the user to register it (we can't start its proxy without the Azure
 * subscription/resource group). For registered AKS Hybrid & Edge clusters it
 * makes sure the local `az connectedk8s proxy` is serving the cluster before its
 * views load, so connecting no longer has to be done by hand from the cluster
 * action menu — opening the cluster is enough.
 *
 * It throws (rejecting the returned promise) when the cluster can't be made
 * reachable; Headlamp core surfaces the thrown message with a retry affordance.
 *
 * @param context.cluster - The kubeconfig context / cluster name being opened.
 * @param context.clusterConf - The cluster's config (carries the server URL).
 */
export async function aksHybridEdgePreOpenHook({
  cluster,
  clusterConf,
  reportProgress,
}: {
  cluster: string;
  clusterConf?: any;
  /** Reports progress text to the "connecting" popup Headlamp shows while we prepare. */
  reportProgress?: (message: string) => void;
}): Promise<void> {
  if (!cluster) {
    return;
  }

  const settings = getClusterSettings(cluster);
  if (settings.clusterType !== 'aksarc') {
    // Not registered as AKS Hybrid & Edge. It may still be an Arc-proxied cluster
    // that was added manually — its context points at the local connectedk8s
    // proxy port, but we have no Azure metadata to start/manage its proxy. If
    // such a cluster isn't already reachable (i.e. no proxy is running for it),
    // guide the user to register it instead of failing opaquely. Genuine non-Arc
    // clusters, and manually-proxied clusters that are already up, are left
    // untouched.
    if (looksLikeArcProxiedCluster(clusterConf)) {
      const reachable = await checkClusterReachable(cluster);
      if (!reachable.success) {
        throw new Error(
          `"${cluster}" looks like an AKS Hybrid & Edge (Arc-connected) cluster but is not ` +
            'registered in AKS Desktop, so its connection cannot be started automatically. ' +
            'Register it via "Register AKS cluster" to connect.'
        );
      }
    }
    return;
  }

  // A proxy started earlier (this session, or one that outlived a renderer
  // reload) may still be serving the cluster. Re-launching would bounce the
  // shared arc-proxy daemon and drop other clusters' connections, so if the
  // cluster is already reachable we're done.
  const reachable = await checkClusterReachable(cluster);
  if (reachable.success) {
    markAksHybridEdgeAppearance(cluster);
    return;
  }

  const { subscriptionId, resourceGroup } = settings;
  if (!subscriptionId || !resourceGroup) {
    throw new Error(
      'Missing Azure metadata for this AKS Hybrid & Edge cluster. Re-register it to reconnect.'
    );
  }

  reportProgress?.('Starting AKS Hybrid & Edge proxy…');
  const start = await startProxy({ subscriptionId, resourceGroup, clusterName: cluster });
  if (!start.success) {
    throw new Error(start.error || 'Failed to start the AKS Hybrid & Edge proxy.');
  }

  reportProgress?.('Verifying cluster connection…');
  const verify = await verifyAksHybridEdgeCluster(cluster, {
    target: { subscriptionId, resourceGroup },
  });
  if (!verify.success) {
    // Leave nothing half-connected behind if verification fails.
    await stopProxy(cluster);
    throw new Error(
      verify.error ||
        'The AKS Hybrid & Edge cluster did not become reachable. ' +
          'It may be stopped or its Azure Arc agents may be offline.'
    );
  }

  markAksHybridEdgeAppearance(cluster);
}
