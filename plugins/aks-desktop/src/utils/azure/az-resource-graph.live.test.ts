// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Read-only live tests comparing Resource Graph REST results with `az`.
 * Require a logged-in `az` and AZ_LIVE_TESTS=1; AZ_LIVE_SUBSCRIPTION is optional.
 */

import { spawn } from 'node:child_process';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  getClusterCount,
  getClusterResourceGroupViaGraph,
  getClustersViaGraph,
  getManagedNamespacesViaGraph,
} from './az-resource-graph';

const LIVE = process.env.AZ_LIVE_TESTS === '1';

/** Runs an `az` command and returns its parsed JSON output. */
function az(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    // cmd.exe would treat `|` in KQL as a pipe, so quote the query on Windows.
    const cliArgs = args.map((arg, index) =>
      isWindows && args[index - 1] === '-q' ? `"${arg}"` : arg
    );
    const child = spawn('az', [...cliArgs, '-o', 'json'], { shell: isWindows });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d));
    child.stderr.on('data', (d: Buffer) => (err += d));
    child.on('error', reject);
    child.on('close', (code: number | null) =>
      code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err))
    );
  });
}

describe.runIf(LIVE)('Resource Graph (live, parity with az)', { timeout: 180_000 }, () => {
  let subscriptionId: string;
  let cliClusters: Array<{ name: string; resourceGroup: string }>;

  beforeAll(async () => {
    // Stand-in for Headlamp's `pluginRunCommand`, backed by a real child process.
    (globalThis as any).pluginRunCommand = (cmd: string, args: string[]) => {
      const child = spawn(cmd, args, { shell: process.platform === 'win32' });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      return child;
    };
    const args = ['account', 'show'];
    if (process.env.AZ_LIVE_SUBSCRIPTION) {
      args.push('--subscription', process.env.AZ_LIVE_SUBSCRIPTION);
    }
    subscriptionId = (await az(args)).id;
    const query =
      "Resources | where type =~ 'microsoft.containerservice/managedclusters' | project id, name, resourceGroup | order by id asc";
    cliClusters = [];
    let skipToken: string | undefined;
    do {
      const graphArgs = ['graph', 'query', '-q', query, '--subscriptions', subscriptionId];
      graphArgs.push('--first', '1000', ...(skipToken ? ['--skip-token', skipToken] : []));
      const page = await az(graphArgs);
      cliClusters.push(...page.data);
      skipToken = page.skip_token ?? undefined;
    } while (skipToken);
  }, 120_000);

  test('getClustersViaGraph and getClusterCount match `az graph query`', async () => {
    const clusters = await getClustersViaGraph(subscriptionId);
    const names = (items: Array<{ name: string }>) => items.map(c => c.name).sort();

    expect(names(clusters)).toEqual(names(cliClusters));
    expect(await getClusterCount(subscriptionId)).toBe(cliClusters.length);
  });

  test('getClusterResourceGroupViaGraph finds a cluster from `az graph query`', async () => {
    const [cluster] = cliClusters;
    if (!cluster) return;
    const matchingGroups = new Set(
      cliClusters.filter(item => item.name === cluster.name).map(item => item.resourceGroup)
    );
    // Names that exist in more than one resource group are ambiguous and resolve to null.
    expect(await getClusterResourceGroupViaGraph(cluster.name, subscriptionId, 'aks')).toBe(
      matchingGroups.size > 1 ? null : cluster.resourceGroup
    );
  });

  test('getManagedNamespacesViaGraph includes everything `az graph query` finds', async () => {
    const query =
      "resources | where type =~ 'microsoft.containerservice/managedclusters/managednamespaces' | project id";
    const [rest, cli] = await Promise.all([
      getManagedNamespacesViaGraph(),
      az(['graph', 'query', '-q', query, '--first', '1000']),
    ]);
    const restIds = new Set(rest.namespaces.map(ns => ns.id.toLowerCase()));

    for (const { id } of cli.data) expect(restIds).toContain(id.toLowerCase());
  });
});
