// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

declare const pluginRunCommand: (
  command: string,
  args: string[],
  options: Record<string, unknown>
) => ReturnType<typeof import('@kinvolk/headlamp-plugin/lib').runCommand>;

/** Status snapshot returned by BareMetal proxy lifecycle functions. */
export interface BareMetalProxyStatus {
  /** Whether the operation itself succeeded. */
  success: boolean;
  /**
   * Current proxy state.
   *
   * `'unknown'` means we have never managed a proxy for this cluster in the
   * current renderer session and a probe to the cluster failed — i.e. there
   * is nothing to report, not that the proxy was actively stopped.
   */
  status: 'unknown' | 'stopped' | 'starting' | 'running' | 'error';
  /** Most recent error message, if any. */
  lastError?: string;
  /** OS process ID of the running proxy, when available. */
  pid?: number;
}

/** Internal bookkeeping for a running `az connectedk8s proxy` process. */
interface BareMetalProxySession {
  /** The child-process handle; `undefined` after the process exits. */
  cmd?: ReturnType<typeof import('@kinvolk/headlamp-plugin/lib').runCommand>;
  /**
   * Mirrors {@link BareMetalProxyStatus.status}. May also hold `'unknown'`
   * as a sentinel for "we probed once and found nothing, but we never
   * managed a proxy here either" — keeps subsequent reconciles from
   * misreporting that absence as a deliberate stop.
   */
  status: BareMetalProxyStatus['status'];
  /** Most recent error message, if any. */
  lastError?: string;
  /** OS process ID, when available. */
  pid?: number;
}

/** In-memory map of active BareMetal proxy sessions, keyed by `subscription/resourceGroup/cluster`. */
const bareMetalProxySessions = new Map<string, BareMetalProxySession>();

/**
 * Probes whether a cluster is reachable by listing its Kubernetes namespaces.
 *
 * @param clusterName - The cluster name to probe.
 * @returns A result indicating reachability plus any error detail.
 */
export async function checkClusterReachable(
  clusterName: string
): Promise<{ success: boolean; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

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
      return { success: false, error: 'Timed out checking cluster reachability' };
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reconciles the in-memory proxy session with actual cluster reachability.
 *
 * After a page reload the process handle is lost, so this function probes
 * the cluster and updates the session map accordingly.
 *
 * @param subscriptionId - Azure subscription GUID.
 * @param resourceGroup - Resource group containing the cluster.
 * @param clusterName - Name of the BareMetal cluster.
 * @returns The reconciled proxy status.
 */
async function reconcileBareMetalProxyStatus(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): Promise<BareMetalProxyStatus> {
  const key = bareMetalProxyKey(subscriptionId, resourceGroup, clusterName);

  const probe = await checkClusterReachable(clusterName);

  if (probe.success) {
    const reconciled: BareMetalProxySession = {
      status: 'running',
      lastError: undefined,
      pid: undefined,
    };
    bareMetalProxySessions.set(key, reconciled);
    return {
      success: true,
      status: 'running',
    };
  }

  const previous = bareMetalProxySessions.get(key);

  // No prior session (or only the synthetic 'unknown' marker from a previous
  // reconcile) means we have no evidence this cluster ever had a proxy in
  // this renderer. Don't pretend the proxy was stopped — surface the absence
  // of state as 'unknown' and don't attach the probe error, which is just
  // "connection refused" against a non-existent listener.
  const isFirstObservation = !previous || previous.status === 'unknown';
  if (isFirstObservation) {
    const unknown: BareMetalProxySession = {
      status: 'unknown',
      lastError: undefined,
      pid: undefined,
    };
    bareMetalProxySessions.set(key, unknown);
    return {
      success: true,
      status: 'unknown',
    };
  }

  const stopped: BareMetalProxySession = {
    ...previous,
    status: 'stopped',
    lastError: probe.error || previous?.lastError,
    pid: previous?.pid,
  };
  bareMetalProxySessions.set(key, stopped);
  return {
    success: true,
    status: 'stopped',
    lastError: stopped.lastError,
  };
}

/** Builds the composite map key for an BareMetal proxy session. */
export function bareMetalProxyKey(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): string {
  return `${subscriptionId}/${resourceGroup}/${clusterName}`;
}

/**
 * Returns the current status of an BareMetal proxy session.
 *
 * If no in-memory session exists (e.g. after a page reload), the cluster is
 * probed for reachability and the status is reconciled automatically.
 *
 * @param subscriptionId - Azure subscription GUID.
 * @param resourceGroup - Resource group containing the cluster.
 * @param clusterName - Name of the BareMetal cluster.
 */
export async function getBareMetalProxyStatus(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): Promise<BareMetalProxyStatus> {
  const key = bareMetalProxyKey(subscriptionId, resourceGroup, clusterName);
  const session = bareMetalProxySessions.get(key);

  // Reconcile after reload/restart where in-memory process handle may be gone.
  if (!session || !session.cmd) {
    return reconcileBareMetalProxyStatus(subscriptionId, resourceGroup, clusterName);
  }

  // Probe the cluster to verify the proxy is actually serving traffic.
  // `az connectedk8s proxy` writes its "listening" message to stderr, so the
  // stdout-driven 'starting' → 'running' transition can't be relied on alone;
  // probing on every poll also makes the polling cadence visible in DevTools.
  const probe = await checkClusterReachable(clusterName);
  const latest = bareMetalProxySessions.get(key);

  if (!latest) {
    return reconcileBareMetalProxyStatus(subscriptionId, resourceGroup, clusterName);
  }

  if (probe.success && latest.cmd && latest.status !== 'running') {
    latest.status = 'running';
    latest.lastError = undefined;
    bareMetalProxySessions.set(key, latest);
  }

  return {
    success: true,
    status: latest.status,
    lastError: latest.lastError,
    pid: latest.pid,
  };
}

/**
 * Starts an `az connectedk8s proxy` process for the given BareMetal cluster.
 *
 * If a proxy is already running (or the cluster is already reachable after a
 * page reload), the existing status is returned without spawning a duplicate.
 *
 * @param subscriptionId - Azure subscription GUID.
 * @param resourceGroup - Resource group containing the cluster.
 * @param clusterName - Name of the BareMetal cluster.
 */
export async function startBareMetalProxy(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): Promise<BareMetalProxyStatus> {
  if (typeof pluginRunCommand === 'undefined') {
    return {
      success: false,
      status: 'error',
      lastError: 'pluginRunCommand is not available.',
    };
  }

  const key = bareMetalProxyKey(subscriptionId, resourceGroup, clusterName);
  const existing = bareMetalProxySessions.get(key);

  // If process handle is gone (after reload), reconcile first so we don't start duplicates.
  if (!existing || !existing.cmd) {
    const reconciled = await reconcileBareMetalProxyStatus(
      subscriptionId,
      resourceGroup,
      clusterName
    );
    if (reconciled.status === 'running') {
      return reconciled;
    }
  }

  if (existing && (existing.status === 'running' || existing.status === 'starting')) {
    return {
      success: true,
      status: existing.status,
      lastError: existing.lastError,
      pid: existing.pid,
    };
  }

  try {
    const cmd = pluginRunCommand(
      'az',
      [
        'connectedk8s',
        'proxy',
        '--subscription',
        subscriptionId,
        '--resource-group',
        resourceGroup,
        '--name',
        clusterName,
      ],
      {}
    );

    const session: BareMetalProxySession = {
      cmd,
      status: 'starting',
      pid: (cmd as any).pid,
    };
    bareMetalProxySessions.set(key, session);

    cmd.stdout.on('data', () => {
      const latest = bareMetalProxySessions.get(key);
      if (latest) {
        latest.status = 'running';
        latest.lastError = undefined;
        bareMetalProxySessions.set(key, latest);
      }
    });

    cmd.stderr.on('data', (data: string) => {
      const latest = bareMetalProxySessions.get(key);
      if (!latest) {
        return;
      }
      const msg = data.toString().trim();
      if (!msg) {
        return;
      }

      // `az connectedk8s proxy` writes its readiness message ("Proxy is
      // listening on port …") to stderr; treat that as the running signal.
      if (/proxy is listening|listening on port \d/i.test(msg)) {
        latest.status = 'running';
        latest.lastError = undefined;
        bareMetalProxySessions.set(key, latest);
        return;
      }

      // Azure CLI routinely writes progress/info lines to stderr while healthy.
      // Only escalate to 'error' when the line clearly indicates a failure, and
      // only when the proxy hasn't already reached the 'running' state.
      const looksLikeError =
        /^\s*ERROR\b/i.test(msg) ||
        /^\s*FATAL\b/i.test(msg) ||
        /^\s*\[.*\]\s*ERROR\b/i.test(msg) ||
        /Traceback \(most recent call last\)/.test(msg);

      if (looksLikeError && latest.status !== 'running') {
        latest.lastError = msg;
        latest.status = 'error';
        bareMetalProxySessions.set(key, latest);
      }
    });

    cmd.on('exit', (code: number | null) => {
      const latest = bareMetalProxySessions.get(key);
      if (!latest) {
        return;
      }
      latest.status = code === 0 ? 'stopped' : 'error';
      if (code !== 0 && !latest.lastError) {
        latest.lastError = `Proxy exited with code ${code}`;
      }
      latest.cmd = undefined;
      bareMetalProxySessions.set(key, latest);
    });

    cmd.on('error', (errOrCode: unknown) => {
      const latest = bareMetalProxySessions.get(key);
      if (!latest) {
        return;
      }
      latest.status = 'error';
      latest.cmd = undefined;
      latest.lastError =
        errOrCode instanceof Error ? errOrCode.message : `Proxy failed: ${String(errOrCode)}`;
      bareMetalProxySessions.set(key, latest);
    });

    return {
      success: true,
      status: 'starting',
      pid: session.pid,
    };
  } catch (error) {
    return {
      success: false,
      status: 'error',
      lastError: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Stops a running `az connectedk8s proxy` process for the given BareMetal cluster.
 *
 * If no proxy session exists the call is a no-op and returns `'stopped'`.
 *
 * @param subscriptionId - Azure subscription GUID.
 * @param resourceGroup - Resource group containing the cluster.
 * @param clusterName - Name of the BareMetal cluster.
 */
export async function stopBareMetalProxy(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): Promise<BareMetalProxyStatus> {
  const key = bareMetalProxyKey(subscriptionId, resourceGroup, clusterName);
  const session = bareMetalProxySessions.get(key);

  if (!session || !session.cmd) {
    return {
      success: true,
      status: 'stopped',
    };
  }

  try {
    if (typeof (session.cmd as any).kill === 'function') {
      (session.cmd as any).kill();
    }
    session.status = 'stopped';
    session.cmd = undefined;
    bareMetalProxySessions.set(key, session);
    return {
      success: true,
      status: 'stopped',
      lastError: session.lastError,
      pid: session.pid,
    };
  } catch (error) {
    session.status = 'error';
    session.lastError = error instanceof Error ? error.message : 'Unknown error';
    bareMetalProxySessions.set(key, session);
    return {
      success: false,
      status: 'error',
      lastError: session.lastError,
      pid: session.pid,
    };
  }
}

/**
 * Restarts the BareMetal proxy by stopping and then starting it again.
 *
 * @param subscriptionId - Azure subscription GUID.
 * @param resourceGroup - Resource group containing the cluster.
 * @param clusterName - Name of the BareMetal cluster.
 */
export async function restartBareMetalProxy(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): Promise<BareMetalProxyStatus> {
  await stopBareMetalProxy(subscriptionId, resourceGroup, clusterName);
  return startBareMetalProxy(subscriptionId, resourceGroup, clusterName);
}
