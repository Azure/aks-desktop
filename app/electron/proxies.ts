/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Portions (c) Microsoft Corp.

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import type { BrowserWindow } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron/main';
import crypto from 'node:crypto';

interface ProxyChildEntry {
  child: ChildProcessWithoutNullStreams;
  group: boolean;
  cluster: string;
}

interface ProxyCommandData {
  id: string;
  command: string;
  args: string[];
  options: {
    detached: boolean;
    cluster: string;
    windowsHide: boolean;
  };
  permissionSecrets: Record<string, number>;
}

interface StartProxyResult {
  success: boolean;
  error?: string;
}

type RunCommand = (
  event: IpcMainEvent | IpcMainInvokeEvent,
  eventData: ProxyCommandData,
  mainWindow: BrowserWindow | null,
  permissionSecrets: Record<string, number>
) => Promise<StartProxyResult>;

/**
 * Live `az connectedk8s proxy` children, tracked so they can be killed when the
 * app quits instead of orphaning their shared arcProxy daemon.
 */
const proxyChildren = new Set<ProxyChildEntry>();

/**
 * In-flight proxy starts keyed by cluster. Duplicate requests await the same
 * result so callers cannot observe success before the original start settles.
 */
const startingProxies = new Map<string, Promise<StartProxyResult>>();

/** Serialises starts because all connected clusters share one arcProxy daemon. */
let proxyStartQueue: Promise<unknown> = Promise.resolve();

/** Set once shutdown starts so a late-spawning child is killed immediately. */
let isShuttingDown = false;

/** How much recent stdout to keep when matching a readiness line across chunks. */
const READY_MATCH_TAIL_CHARS = 256;

/** Upper bound on waiting for a proxy to report itself ready. */
const PROXY_READY_TIMEOUT_MS = 30_000;

const SUBSCRIPTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCE_GROUP_PATTERN = /^[A-Za-z0-9_().-]{1,90}$/;
const CLUSTER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;

/** Returns the live proxy child spawned for a cluster, if any. */
function liveChildForCluster(cluster: string): ProxyChildEntry | undefined {
  for (const entry of proxyChildren) {
    if (entry.cluster === cluster) {
      return entry;
    }
  }
  return undefined;
}

/**
 * Resolves when a start reports ready, exits, fails to spawn, or times out, so
 * the next cluster can safely register with the shared daemon.
 */
function waitForProxyReady(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = PROXY_READY_TIMEOUT_MS
): Promise<void> {
  return new Promise<void>(resolve => {
    let settled = false;

    function cleanup() {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.off('exit', finish);
      child.off('error', finish);
    }

    function finish() {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    }

    let tail = '';
    function onData(data: string | Buffer) {
      tail = (tail + data.toString()).slice(-READY_MATCH_TAIL_CHARS);
      if (/Start sending kubectl requests/i.test(tail)) {
        finish();
      }
    }

    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', onData);
    child.once('exit', finish);
    child.once('error', finish);
  });
}

/** Sends a signal to a proxy child and any daemon in its process group. */
function signalChildEntry({ child, group }: ProxyChildEntry, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (!pid) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
      killer.on('error', () => {});
    } else if (group) {
      process.kill(-pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      console.error(`[AKS][main] failed to ${signal} proxy pid ${pid}:`, error);
    }
  }
}

/**
 * Tracks a proxy child spawned by the generic command runner.
 *
 * @param command - Spawned executable.
 * @param args - Arguments passed to the executable.
 * @param options - Command options, including the optional cluster marker.
 * @param child - Spawned child process.
 * @returns A function that removes the child from proxy tracking.
 */
export function trackProxyChild(
  command: string,
  args: string[],
  options: { cluster?: string; detached?: boolean },
  child: ChildProcessWithoutNullStreams
): () => void {
  const cluster = options.cluster;
  const isProxyCommand = command === 'az' && args[0] === 'connectedk8s' && args[1] === 'proxy';
  if (!cluster || !isProxyCommand) {
    return () => {};
  }

  const entry = { child, group: !!options.detached, cluster };
  if (isShuttingDown) {
    signalChildEntry(entry, 'SIGKILL');
    return () => {};
  }

  proxyChildren.add(entry);
  return () => proxyChildren.delete(entry);
}

/**
 * Kills every tracked proxy and any daemon it launched when the app quits.
 *
 * @returns Nothing.
 */
export function killAllProxies(): void {
  isShuttingDown = true;
  for (const entry of proxyChildren) {
    signalChildEntry(entry, 'SIGKILL');
  }
  proxyChildren.clear();
}

/**
 * Registers the cluster-proxy IPC handler, coalescing concurrent starts for the
 * same cluster while serialising starts across clusters.
 */
export function setupProxyHandlers(
  mainWindow: BrowserWindow,
  ipcMain: Electron.IpcMain,
  permissionSecrets: Record<string, number>,
  runCommand: RunCommand
): void {
  isShuttingDown = false;
  proxyStartQueue = Promise.resolve();

  ipcMain.handle('start-cluster-proxy', async (event, eventData): Promise<StartProxyResult> => {
    const { cluster, subscriptionId, resourceGroup } = (eventData ?? {}) as {
      cluster?: string;
      subscriptionId?: string;
      resourceGroup?: string;
    };
    console.log(`[AKS][main] start-cluster-proxy received: cluster=${cluster}`);
    if (!cluster || !subscriptionId || !resourceGroup) {
      return { success: false, error: 'Cluster proxy target is incomplete.' };
    }
    if (
      !SUBSCRIPTION_ID_PATTERN.test(subscriptionId) ||
      !RESOURCE_GROUP_PATTERN.test(resourceGroup) ||
      !CLUSTER_NAME_PATTERN.test(cluster)
    ) {
      return { success: false, error: 'Cluster proxy target is invalid.' };
    }
    if (isShuttingDown) {
      return { success: false, error: 'The app is shutting down.' };
    }
    const existingStart = startingProxies.get(cluster);
    if (existingStart) {
      return existingStart;
    }
    if (liveChildForCluster(cluster)) {
      return { success: true };
    }

    const commandData: ProxyCommandData = {
      id: `cluster-proxy:${cluster}:${crypto.randomUUID()}`,
      command: 'az',
      args: [
        'connectedk8s',
        'proxy',
        '--subscription',
        subscriptionId,
        '--resource-group',
        resourceGroup,
        '--name',
        cluster,
      ],
      options: { detached: true, cluster, windowsHide: true },
      permissionSecrets,
    };

    console.log(`[AKS][main] spawning proxy for cluster=${cluster}`);
    const started = proxyStartQueue.then(() =>
      runCommand(event, commandData, mainWindow, permissionSecrets)
    );
    startingProxies.set(cluster, started);
    proxyStartQueue = started
      .then(result => {
        if (!result.success) {
          return;
        }
        const entry = liveChildForCluster(cluster);
        return entry && waitForProxyReady(entry.child);
      })
      .catch(() => undefined);

    try {
      return await started;
    } finally {
      startingProxies.delete(cluster);
    }
  });
}
