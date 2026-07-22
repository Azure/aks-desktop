// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { getErrorMessage, runAzCommand } from './az-cli-core';

// The Electron preload exposes `window.desktopApi.send(channel, data)`. Proxy
// lifecycle is owned by the app (main) layer, so the plugin only sends
// start/stop intents by cluster name and observes the result via reachability.
// `desktopApi` is declared `any` globally by the app types, so we read it via a
// narrowly-typed cast rather than redeclaring the Window interface.
type DesktopApiSend = (channel: string, data: unknown) => void;
function getDesktopApiSend(): DesktopApiSend | undefined {
  const api = (window as any)?.desktopApi;
  return typeof api?.send === 'function' ? (api.send as DesktopApiSend) : undefined;
}

/** Identifies an AKS Hybrid & Edge (Arc-connected) cluster the proxy can target. */
export interface ProxyTarget {
  /** Azure subscription GUID. */
  subscriptionId: string;
  /** Azure resource group containing the cluster. */
  resourceGroup: string;
  /** Arc-connected cluster name (also the kubeconfig context name). */
  clusterName: string;
}

/** Result of a {@link startProxy} call. */
export interface StartProxyResult {
  success: boolean;
  /** Error detail when `success` is false. */
  error?: string;
}

/** How long a single reachability probe may take. */
const REACHABILITY_TIMEOUT_MS = 5_000;

/**
 * Builds the Azure portal deep link to a connected cluster's Overview blade,
 * where a user can inspect its health / "Current state" when it's Failed.
 */
export function azurePortalClusterUrl(
  target: Pick<ProxyTarget, 'subscriptionId' | 'resourceGroup' | 'clusterName'>
): string {
  const resourceId =
    `/subscriptions/${target.subscriptionId}/resourceGroups/${target.resourceGroup}` +
    `/providers/Microsoft.Kubernetes/connectedClusters/${target.clusterName}`;
  return `https://portal.azure.com/#@/resource${resourceId}/overview`;
}

/**
 * Asks the app (main) layer to start `az connectedk8s proxy` for a cluster.
 *
 * Fire-and-forget by design: the proxy is a long-running process owned by the
 * main process, which is idempotent per cluster (a duplicate start is a no-op,
 * so it never launches a second proxy or bounces the shared arcProxy daemon) and
 * kills it on app quit. Real connectivity is confirmed by the caller via
 * {@link verifyAksHybridEdgeCluster}.
 *
 * @param target - The cluster to proxy to.
 */
export async function startProxy(target: ProxyTarget): Promise<StartProxyResult> {
  const send = getDesktopApiSend();
  if (!send) {
    return { success: false, error: 'Desktop bridge is not available.' };
  }
  try {
    send('start-aks-hybrid-edge-proxy', {
      cluster: target.clusterName,
      subscriptionId: target.subscriptionId,
      resourceGroup: target.resourceGroup,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Asks the app (main) layer to stop the proxy for a cluster. Keyed by cluster
 * name, so it works even after a renderer reload (the renderer keeps no proxy
 * state). The main process group-kills the proxy and its arcProxy daemon.
 *
 * @param clusterName - The cluster (context) name whose proxy to stop.
 */
export async function stopProxy(
  clusterName: string
): Promise<{ success: boolean; error?: string }> {
  const send = getDesktopApiSend();
  if (!send) {
    // No bridge (e.g. non-app mode) — nothing to stop.
    return { success: true };
  }
  try {
    send('stop-aks-hybrid-edge-proxy', { cluster: clusterName });
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Probes whether a cluster is reachable through Headlamp by listing a single
 * namespace. This is the source of truth for whether the proxy is serving the
 * cluster (the menu shows Stop when reachable, Start when not).
 *
 * @param clusterName - The kubeconfig context / Headlamp cluster name to probe.
 */
export async function checkClusterReachable(
  clusterName: string
): Promise<{ success: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);

  try {
    await ApiProxy.clusterRequest(
      '/api/v1/namespaces',
      {
        cluster: clusterName,
        isJSON: true,
        autoLogoutOnAuthError: false,
        signal: controller.signal,
      },
      { limit: '1' }
    );
    return { success: true };
  } catch (error) {
    const aborted =
      (error instanceof Error && error.name === 'AbortError') || controller.signal.aborted;
    if (aborted) {
      return { success: false, error: 'Timed out checking cluster reachability.' };
    }
    return { success: false, error: getErrorMessage(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches the set of cluster (context) names Headlamp currently knows about. */
async function getHeadlampClusterNames(): Promise<Set<string>> {
  try {
    // `/config` is a Headlamp-server endpoint (not cluster-scoped), so pass
    // useCluster=false. It returns `{ clusters: [{ name, server, ... }] }` — an
    // ARRAY of cluster objects (kubeconfig contexts the backend has loaded).
    const config = await ApiProxy.request('/config', {}, false, false);
    const clusters = (config && (config as any).clusters) ?? [];
    const names = Array.isArray(clusters)
      ? clusters.map((c: any) => c?.name).filter(Boolean)
      : Object.keys(clusters); // defensive: tolerate a name-keyed object too
    return new Set<string>(names);
  } catch {
    return new Set<string>();
  }
}

/**
 * Whether the cluster's context is present in Headlamp's kubeconfig-derived
 * cluster list. `az connectedk8s proxy` writes the context to `~/.kube/config`;
 * Headlamp's backend watches that file and loads new contexts within its watch
 * interval, so this may only become true a few seconds after the proxy starts.
 *
 * @param clusterName - The kubeconfig context / Headlamp cluster name.
 */
export async function isClusterInKubeconfig(clusterName: string): Promise<boolean> {
  const names = await getHeadlampClusterNames();
  return names.has(clusterName);
}

/** Outcome of {@link verifyAksHybridEdgeCluster}. */
export interface VerifyResult {
  success: boolean;
  /** Whether the proxy added the cluster's context to kubeconfig. */
  inKubeconfig: boolean;
  /** Whether the cluster answered a Kubernetes API probe through the proxy. */
  reachable: boolean;
  /**
   * The Azure runtime **"Current state"** (`status.currentState`), when it could
   * be determined (only queried when a reachability failure needs explaining).
   * A non-`Succeeded` value means the cluster is unhealthy in Azure — distinct
   * from Arc connectivity, which may still be "Connected".
   */
  currentState?: string;
  error?: string;
}

/** Runtime health of an AKS-Arc cluster, as reported by Azure. */
export interface ClusterHealth {
  /**
   * The runtime **"Current state"** shown in the Azure portal (e.g. `Succeeded`
   * or `Failed`). This is `status.currentState` on the provisioned-cluster
   * instance — distinct from the connected cluster's `provisioningState` (which
   * only reflects whether the ARM deployment finished) and from Arc
   * connectivity ("Status"). A cluster can be Arc-Connected and have a
   * `Succeeded` provisioningState yet a `Failed` currentState.
   */
  currentState: string | null;
  /** Azure's human-readable reason when the cluster is unhealthy. */
  errorMessage?: string;
}

/** ARM API version for the HybridContainerService provisioned-cluster instance. */
const PROVISIONED_CLUSTER_API_VERSION = '2024-01-01';

/**
 * Reads the AKS-Arc cluster's runtime health (`status.currentState` and its
 * `errorMessage`) from the `provisionedClusterInstances/default` resource via
 * `az rest`. This is the "Current state" a user sees in the Azure portal — the
 * field that actually goes `Failed` when the cluster is up in ARM but its
 * Kubernetes API isn't reachable.
 *
 * Degrades gracefully: for a generic Arc-connected cluster (no AKS-Arc
 * provisioned instance) the call 404s and this returns `{ currentState: null }`.
 */
export async function getClusterCurrentState(
  target: Pick<ProxyTarget, 'subscriptionId' | 'resourceGroup' | 'clusterName'>
): Promise<ClusterHealth> {
  const url =
    `https://management.azure.com/subscriptions/${target.subscriptionId}` +
    `/resourceGroups/${target.resourceGroup}` +
    `/providers/Microsoft.Kubernetes/connectedClusters/${target.clusterName}` +
    `/providers/Microsoft.HybridContainerService/provisionedClusterInstances/default` +
    `?api-version=${PROVISIONED_CLUSTER_API_VERSION}`;

  const res = await runAzCommand<ClusterHealth>(
    ['rest', '--method', 'get', '--url', url, '--query', 'properties.status', '-o', 'json'],
    '[AKS] Querying cluster current state:',
    'query cluster current state',
    stdout => {
      try {
        const status = JSON.parse(stdout) as { currentState?: string; errorMessage?: string };
        return { currentState: status?.currentState ?? null, errorMessage: status?.errorMessage };
      } catch {
        return { currentState: null };
      }
    }
  );
  return res.success && res.data ? res.data : { currentState: null };
}

/**
 * Confirms a freshly-started AKS Hybrid & Edge cluster is usable in two ordered
 * phases, so we never probe the cluster API before Headlamp knows about it:
 *
 *  1. **In kubeconfig** — poll `/config` until the backend has loaded the
 *     proxy-written context (`az connectedk8s proxy` writes it to
 *     `~/.kube/config`; the backend picks it up on its file-watch cycle).
 *     Probing the cluster API before this returns "cluster not found", so we
 *     wait for the context to appear first.
 *  2. **Reachable** — then poll the Kubernetes API (`/api/v1/namespaces`) until
 *     the cluster answers (the Arc cluster-connect endpoint warms up in the
 *     background).
 *
 * Both phases share the overall budget and poll on a short fixed interval.
 *
 * @param clusterName - The kubeconfig context / Headlamp cluster name.
 * @param options.timeoutMs - Overall budget (default 60s).
 * @param options.intervalMs - Delay between poll attempts (default 2s).
 * @param options.target - When provided, a Phase-2 (unreachable) failure queries
 *   the cluster's Azure `provisioningState` to explain *why* it's unreachable
 *   (e.g. the cluster is in a `Failed` state, not a proxy problem).
 */
export async function verifyAksHybridEdgeCluster(
  clusterName: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    target?: Pick<ProxyTarget, 'subscriptionId' | 'resourceGroup'>;
  } = {}
): Promise<VerifyResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  const delay = () => new Promise(resolve => setTimeout(resolve, intervalMs));

  // Phase 1 — wait for the backend to load the proxy-written context. No
  // cluster-API probe happens until this succeeds.
  while (!(await isClusterInKubeconfig(clusterName))) {
    if (Date.now() >= deadline) {
      return {
        success: false,
        inKubeconfig: false,
        reachable: false,
        error:
          'The proxy did not add the cluster to kubeconfig in time. ' +
          'The cluster may be stopped or its Azure Arc agents may be offline.',
      };
    }
    await delay();
  }

  // Phase 2 — context is loaded; now wait until the cluster answers the API.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const reachable = await checkClusterReachable(clusterName);
    if (reachable.success) {
      return { success: true, inKubeconfig: true, reachable: true };
    }
    if (Date.now() >= deadline) {
      // The proxy is up (context is loaded) but the cluster's API never
      // answered. When we have the Azure coordinates, ask Azure *why*: a
      // non-`Succeeded` currentState means the cluster itself is unhealthy —
      // something AKS Desktop can't fix — as opposed to a transient timeout.
      let currentState: string | undefined;
      let azureReason: string | undefined;
      if (options.target) {
        const health = await getClusterCurrentState({
          subscriptionId: options.target.subscriptionId,
          resourceGroup: options.target.resourceGroup,
          clusterName,
        });
        currentState = health.currentState ?? undefined;
        azureReason = health.errorMessage;
      }

      const unhealthy = !!currentState && currentState !== 'Succeeded';
      const error = unhealthy
        ? `Cluster "${clusterName}" is in a "${currentState}" state in Azure` +
          (azureReason ? `: ${azureReason}` : '.') +
          ' Azure Arc connectivity is fine, but the cluster is not responding, so it ' +
          "cannot be reached. This can't be fixed from AKS Desktop — check the " +
          "cluster's health in the Azure portal."
        : reachable.error;

      return {
        success: false,
        inKubeconfig: true,
        reachable: false,
        currentState,
        error,
      };
    }
    await delay();
  }
}
