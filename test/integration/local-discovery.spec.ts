// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { writeKubeconfigAtomically } from '../../node_modules/@headlamp-k8s/headlamp-source/source/app/electron/cluster-registration';

vi.mock(
  '../../node_modules/@headlamp-k8s/headlamp-source/source/app/electron/secureStorage',
  () => ({
    isTrustedDocumentUrl: () => {
      throw new Error('Discovery tests do not use Electron IPC or renderer capabilities');
    },
  })
);

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(
  root,
  'node_modules/@headlamp-k8s/headlamp-source/source/app/dist/win-unpacked/resources/headlamp-server.exe'
);

/**
 * A kubeconfig with one cluster, user and context per name. With no names it is the file client-go
 * writes after `aks-devctl cluster delete --prune-kubeconfig` removes the last context: every
 * list is null.
 */
function fixture(names: string[]): string {
  if (names.length === 0) {
    return JSON.stringify({
      apiVersion: 'v1',
      kind: 'Config',
      clusters: null,
      contexts: null,
      users: null,
      'current-context': '',
    });
  }
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Config',
    clusters: names.map(name => ({
      name,
      cluster: {
        server: 'https://127.0.0.1:65535',
        'insecure-skip-tls-verify': true,
      },
    })),
    contexts: names.map(name => ({ name, context: { cluster: name, user: name } })),
    users: names.map(name => ({ name, user: { token: 'synthetic-discovery-test-token' } })),
    'current-context': names[names.length - 1],
  });
}

async function unusedPort(): Promise<number> {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') {
    listener.close();
    throw new Error('Expected a loopback TCP listener');
  }
  await new Promise<void>((resolve, reject) =>
    listener.close(error => (error ? reject(error) : resolve()))
  );
  return address.port;
}

// The AKS Desktop CLI owns the user's default kubeconfig: `cluster create` adds the
// cluster's context and `cluster delete --prune-kubeconfig` removes it, each by an atomic
// temp-file rename. The backend must follow both, including removals and an all-null file.
it.each([true, false])(
  'follows atomic CLI rewrites of the default kubeconfig (another context present: %s)',
  async ordinaryExists => {
    expect(process.platform, 'Run this opt-in check with native Windows Node').toBe('win32');
    expect(process.arch).toBe('x64');
    expect(fs.existsSync(backend), 'Build the unpacked Windows application first').toBe(true);

    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aksdesktop-discovery-'));
    let server: ReturnType<typeof spawn> | undefined;
    let closed: Promise<void> | undefined;
    try {
      const kubeconfig = path.join(temporaryRoot, '.kube', 'config');
      const directory = path.join(temporaryRoot, 'kubeconfigs');
      const plugins = path.join(temporaryRoot, 'empty-plugins');
      fs.mkdirSync(path.dirname(kubeconfig));
      fs.mkdirSync(directory);
      fs.mkdirSync(plugins);
      const baseNames = ordinaryExists ? ['ordinary'] : [];
      if (ordinaryExists) fs.writeFileSync(kubeconfig, fixture(baseNames));
      const port = await unusedPort();
      const token = randomBytes(32).toString('hex');
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const key of Object.keys(env)) {
        const name = key.toUpperCase();
        if (name.startsWith('HEADLAMP_') || name === 'KUBECONFIG') delete env[key];
      }
      Object.assign(env, {
        HOME: temporaryRoot,
        USERPROFILE: temporaryRoot,
        APPDATA: path.join(temporaryRoot, 'Roaming'),
        LOCALAPPDATA: path.join(temporaryRoot, 'Local'),
        HEADLAMP_BACKEND_TOKEN: token,
      });
      const child = spawn(
        backend,
        [
          '--listen-addr',
          '127.0.0.1',
          '--port',
          String(port),
          '--kubeconfig',
          kubeconfig,
          '--kubeconfig-dir',
          directory,
          '--plugins-dir',
          plugins,
          '--user-plugins-dir',
          plugins,
        ],
        { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      server = child;
      let spawnError: Error | undefined;
      child.on('error', error => {
        spawnError = error;
      });
      closed = new Promise<void>(resolve => child.once('close', () => resolve()));
      let logs = '';
      const recordLog = (chunk: Buffer) => {
        logs = (logs + chunk.toString('utf8')).slice(-65536);
      };
      child.stdout.on('data', recordLog);
      child.stderr.on('data', recordLog);
      const url = `http://127.0.0.1:${port}/config`;

      async function clusterNames(): Promise<string[]> {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`Synthetic discovery backend exited (${child.exitCode})`);
        }
        const response = await fetch(url, {
          headers: { 'X-HEADLAMP_BACKEND-TOKEN': token },
          signal: AbortSignal.timeout(2000),
        });
        expect(response.status).toBe(200);
        const data: unknown = await response.json();
        if (
          typeof data !== 'object' ||
          !data ||
          !('clusters' in data) ||
          !Array.isArray(data.clusters)
        ) {
          throw new Error('Backend config did not contain a clusters array');
        }
        return data.clusters
          .map((cluster: unknown) => {
            if (
              typeof cluster !== 'object' ||
              !cluster ||
              !('name' in cluster) ||
              typeof cluster.name !== 'string'
            ) {
              throw new Error('Backend cluster entry did not contain its public name');
            }
            return cluster.name;
          })
          .sort();
      }

      const waitForNames = async (names: string[]) => {
        try {
          await expect
            .poll(clusterNames, { timeout: 25000, interval: 250 })
            .toEqual([...names].sort());
        } catch (error) {
          const watcherEvents = logs
            .split('\n')
            .slice(0, -1)
            .filter(line => line.startsWith('{') && line.includes('watcher:'))
            .slice(-10);
          throw new Error(
            `Expected ${JSON.stringify(names)}; ` +
              `kubeconfig present: ${fs.existsSync(kubeconfig)}; ` +
              `watcher events: ${JSON.stringify(watcherEvents)}`,
            { cause: error }
          );
        }
      };

      await waitForNames(baseNames);
      expect((await fetch(url, { signal: AbortSignal.timeout(2000) })).status).toBe(403);
      if (!ordinaryExists) {
        // A missing default kubeconfig is reported once at startup, not as a watcher failure;
        // Create writes it later.
        await expect.poll(() => logs, { timeout: 5000 }).toContain('kubeconfig not found');
      }

      // cluster create
      writeKubeconfigAtomically(kubeconfig, fixture([...baseNames, 'dev-cluster']));
      await waitForNames([...baseNames, 'dev-cluster']);

      // A later rewrite that drops the context must retire it, not only add new ones.
      writeKubeconfigAtomically(kubeconfig, fixture([...baseNames, 'replacement']));
      await waitForNames([...baseNames, 'replacement']);

      // cluster delete --prune-kubeconfig; without another context every list is null.
      writeKubeconfigAtomically(kubeconfig, fixture(baseNames));
      await waitForNames(baseNames);
    } finally {
      // Only this test-owned synthetic backend is terminated; no Desktop, CLI, or guest is used.
      if (server && server.exitCode === null && server.signalCode === null) server.kill();
      await closed;
      fs.rmSync(temporaryRoot, { recursive: true });
    }
  }
);
