// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { getErrorMessage, runAzCommand } from './az-cli-core';

// Proxy lifecycle is owned by the app (main) layer. There is no stop intent:
// arcProxy is a machine-wide daemon shared by every connected cluster, and it
// is torn down when the app quits.
// `desktopApi` is declared `any` globally by the app types, so we read it via a
// narrowly-typed cast rather than redeclaring the Window interface.
type DesktopApiStartProxy = (target: {
  cluster: string;
  subscriptionId: string;
  resourceGroup: string;
}) => Promise<StartProxyResult>;
function getDesktopApiStartProxy(): DesktopApiStartProxy | undefined {
  const api = (window as any)?.desktopApi;
  return typeof api?.startClusterProxy === 'function'
    ? (api.startClusterProxy as DesktopApiStartProxy)
    : undefined;
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
  }
}

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
 * Resolves after the main process has started the proxy, or with an immediate
 * consent/spawn error. Real connectivity is confirmed by the caller via
 * {@link verifyAksHybridEdgeCluster}.
 *
 * @param target - The cluster to proxy to.
 */
export async function startProxy(target: ProxyTarget): Promise<StartProxyResult> {
  const startClusterProxy = getDesktopApiStartProxy();
  if (!startClusterProxy) {
    return { success: false, error: 'Desktop bridge is not available.' };
  }
  try {
    return await startClusterProxy({
      cluster: target.clusterName,
      subscriptionId: target.subscriptionId,
      resourceGroup: target.resourceGroup,
    });
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Probes whether a cluster is reachable through Headlamp by asking the API
 * server for its version. This is the source of truth for whether the proxy is
 * serving the cluster (the menu offers Start only when it is not).
 *
 * `/version` is deliberate: it is served to any authenticated user, so the probe
 * answers "can we talk to this cluster" and not "what may this user do on it".
 * A permission-scoped endpoint (listing namespaces, say) returns 403 on an Arc
 * cluster that grants only namespace-scoped access — which would report a
 * perfectly healthy proxy as unreachable and offer to start one that is already
 * running.
 *
 * @param clusterName - The kubeconfig context / Headlamp cluster name to probe.
 * @param signal - Cancels the probe when its caller no longer needs the result.
 */
export async function checkClusterReachable(
  clusterName: string,
  signal?: AbortSignal
): Promise<{ success: boolean; error?: string }> {
  throwIfAborted(signal);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });

  try {
    await ApiProxy.clusterRequest('/version', {
      cluster: clusterName,
      isJSON: true,
      autoLogoutOnAuthError: false,
      signal: controller.signal,
    });
    return { success: true };
  } catch (error) {
    throwIfAborted(signal);
    const aborted =
      (error instanceof Error && error.name === 'AbortError') || controller.signal.aborted;
    if (aborted) {
      return { success: false, error: 'Timed out checking cluster reachability.' };
    }
    return { success: false, error: getErrorMessage(error) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * Determines whether a cluster is actually accessible by making live Kubernetes
 * API requests, rather than trusting a cached Arc heartbeat/connectivity status.
 *
 * Probes with {@link checkClusterReachable} up to `attempts` times back-to-back;
 * the cluster is considered accessible as soon as one probe succeeds, and only
 * marked inaccessible when every attempt fails (the last error is returned).
 * Each probe carries its own {@link REACHABILITY_TIMEOUT_MS} timeout, so an
 * unresponsive cluster fails fast per attempt.
 *
 * @param clusterName - The kubeconfig context / Headlamp cluster name to probe.
 * @param attempts - Number of sequential probes before declaring it inaccessible
 *   (default 3).
 */
export async function checkClusterAccessible(
  clusterName: string,
  attempts = 3
): Promise<{ accessible: boolean; error?: string }> {
  let lastError: string | undefined;
  for (let i = 0; i < attempts; i++) {
    const result = await checkClusterReachable(clusterName);
    if (result.success) {
      return { accessible: true };
    }
    lastError = result.error;
  }
  return { accessible: false, error: lastError };
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
 *  2. **Reachable** — then poll the Kubernetes API (`/version`) until the
 *     cluster answers (the Arc cluster-connect endpoint warms up in the
 *     background). Version is unprivileged on purpose: verification asks whether
 *     the cluster is connected, not whether this user may read anything on it.
 *
 * Both phases share the overall budget and poll on a short fixed interval.
 *
 * @param clusterName - The kubeconfig context / Headlamp cluster name.
 * @param options.timeoutMs - Overall budget (default 60s).
 * @param options.intervalMs - Delay between poll attempts (default 2s).
 * @param options.signal - Cancels verification and any active polling delay.
 * @param options.target - When provided, a Phase-2 (unreachable) failure queries
 *   the cluster's Azure `provisioningState` to explain *why* it's unreachable
 *   (e.g. the cluster is in a `Failed` state, not a proxy problem).
 */
export async function verifyAksHybridEdgeCluster(
  clusterName: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
    target?: Pick<ProxyTarget, 'subscriptionId' | 'resourceGroup'>;
  } = {}
): Promise<VerifyResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  const delay = () =>
    new Promise<void>((resolve, reject) => {
      throwIfAborted(options.signal);
      const timer = setTimeout(() => {
        options.signal?.removeEventListener('abort', abort);
        resolve();
      }, intervalMs);
      const abort = () => {
        clearTimeout(timer);
        reject(
          options.signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError')
        );
      };
      options.signal?.addEventListener('abort', abort, { once: true });
    });

  throwIfAborted(options.signal);

  // Phase 1 — wait for the backend to load the proxy-written context. No
  // cluster-API probe happens until this succeeds.
  while (!(await isClusterInKubeconfig(clusterName))) {
    throwIfAborted(options.signal);
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
    const reachable = await checkClusterReachable(clusterName, options.signal);
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
