// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { writeKubeconfigAtomically } from '../../node_modules/@headlamp-k8s/headlamp-source/source/app/electron/cluster-registration';
import {
  LOCAL_CONFIG_FILE,
  withLocalKubeconfigPath,
} from '../../node_modules/@headlamp-k8s/headlamp-source/source/app/electron/local-kubeconfig';

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

function fixture(name: string): string {
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Config',
    clusters: [
      {
        name,
        cluster: {
          server: 'https://127.0.0.1:65535',
          'insecure-skip-tls-verify': true,
        },
      },
    ],
    contexts: [{ name, context: { cluster: name, user: name } }],
    users: [{ name, user: { token: 'synthetic-discovery-test-token' } }],
    'current-context': name,
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

it.each([true, false])(
  'discovers private-file creation, atomic replacement, and removal (ordinary file: %s)',
  async ordinaryExists => {
    expect(process.platform, 'Run this opt-in check with native Windows Node').toBe('win32');
    expect(process.arch).toBe('x64');
    expect(fs.existsSync(backend), 'Build the unpacked Windows application first').toBe(true);

    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aksdesktop-discovery-'));
    let server: ReturnType<typeof spawn> | undefined;
    let closed: Promise<void> | undefined;
    try {
      const ordinary = path.join(temporaryRoot, 'ordinary.yaml');
      const directory = path.join(temporaryRoot, 'managed');
      const managed = path.join(directory, LOCAL_CONFIG_FILE);
      const plugins = path.join(temporaryRoot, 'empty-plugins');
      fs.mkdirSync(directory);
      fs.mkdirSync(plugins);
      if (ordinaryExists) fs.writeFileSync(ordinary, fixture('ordinary'));
      const ordinaryHash = ordinaryExists
        ? createHash('sha256').update(fs.readFileSync(ordinary)).digest('hex')
        : undefined;
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
      const configuredPaths = withLocalKubeconfigPath(ordinary, directory);
      if (!configuredPaths) throw new Error('Windows x64 discovery paths were not configured');

      const child = spawn(
        backend,
        [
          '--listen-addr',
          '127.0.0.1',
          '--port',
          String(port),
          '--kubeconfig',
          configuredPaths,
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

      const baseNames = ordinaryExists ? ['ordinary'] : [];
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
            `Expected ${JSON.stringify(names)}; private file present: ${fs.existsSync(managed)}; ` +
              `watcher events: ${JSON.stringify(watcherEvents)}`,
            { cause: error }
          );
        }
      };

      await waitForNames(baseNames);
      expect((await fetch(url, { signal: AbortSignal.timeout(2000) })).status).toBe(403);
      await expect.poll(() => logs, { timeout: 5000 }).toContain('Path does not exist');
      expect(fs.existsSync(managed)).toBe(false);

      writeKubeconfigAtomically(managed, fixture('local'));
      await waitForNames([...baseNames, 'local']);

      writeKubeconfigAtomically(managed, fixture('replacement'));
      await waitForNames([...baseNames, 'replacement']);

      fs.unlinkSync(managed);
      await waitForNames(baseNames);
      if (ordinaryExists) {
        expect(createHash('sha256').update(fs.readFileSync(ordinary)).digest('hex')).toBe(
          ordinaryHash
        );
      } else {
        expect(fs.existsSync(ordinary)).toBe(false);
      }
    } finally {
      // Only this test-owned synthetic backend is terminated; no Desktop, CLI, or guest is used.
      if (server && server.exitCode === null && server.signalCode === null) server.kill();
      await closed;
      fs.rmSync(temporaryRoot, { recursive: true });
    }
  }
);
