// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { getLoginStatus } from './az-auth';
import { getClusterInfo, getClusterResourceIdAndGroup, getClusters } from './az-clusters';
import * as graph from './az-resource-graph';

const LIVE = process.env.AZ_LIVE_TESTS === '1' && !process.env.CI;

// Azure errors may contain account/resource identifiers. Never send them to the reporter.
async function readLive<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    throw new Error('Live Azure read failed; check the current az login and read permissions.');
  }
}

function expectClusterShapes(clusters: Awaited<ReturnType<typeof getClusters>>) {
  expect(Array.isArray(clusters)).toBe(true);
  for (const cluster of clusters) {
    // Assert booleans/types, not resource values that a failed assertion would print.
    expect(typeof cluster.name).toBe('string');
    expect(typeof cluster.resourceGroup).toBe('string');
    expect(typeof cluster.subscription).toBe('string');
    expect(typeof cluster.location).toBe('string');
    expect(typeof cluster.nodeCount).toBe('number');
  }
}

describe.runIf(LIVE)('managed AKS discovery (live, read-only)', { timeout: 120_000 }, () => {
  let subscription: string;

  beforeAll(async () => {
    // Production debug/warning paths include Azure identifiers, even on successful reads.
    for (const method of ['debug', 'log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation(() => {});
    }
    // Reuse the native command bridge pattern from the other Azure live suites.
    vi.stubGlobal('pluginRunCommand', (cmd: string, args: string[]) => {
      const operation = args.slice(0, 2).join(' ');
      if (
        cmd !== 'az' ||
        !['account show', 'account get-access-token', 'cloud show'].includes(operation)
      ) {
        throw new Error('Only read-only Azure authentication commands are allowed in this suite.');
      }
      const child = spawn(cmd, args, { shell: process.platform === 'win32' });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      return child;
    });
    const account = await readLive(() => getLoginStatus());
    if (!account.isLoggedIn || !account.subscriptionId) {
      throw new Error('Live tests require an existing az login with a current subscription.');
    }
    subscription = account.subscriptionId;
  }, 120_000);

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('lists cluster summaries through the normal Graph-first path', async () => {
    expectClusterShapes(await readLive(() => getClusters(subscription)));
  });

  test('lists cluster summaries through real ARM when Graph is unavailable', async () => {
    const graphList = vi
      .spyOn(graph, 'getClustersViaGraph')
      .mockRejectedValue(new Error('Graph bypassed for live ARM coverage'));
    try {
      expectClusterShapes(await readLive(() => getClusters(subscription)));
    } finally {
      graphList.mockRestore();
    }
  });

  test('resolves info and resource identity for a cluster from the ARM list', async context => {
    const graphList = vi
      .spyOn(graph, 'getClustersViaGraph')
      .mockRejectedValue(new Error('Graph bypassed for live ARM coverage'));
    const graphGroup = vi.spyOn(graph, 'getClusterResourceGroupViaGraph').mockResolvedValue(null);
    try {
      const clusters = await readLive(() => getClusters(subscription));
      // A name shared by resource groups cannot identify a unique cluster to getClusterInfo.
      const cluster = clusters.find(
        item => clusters.filter(other => other.name === item.name).length === 1
      );
      if (!cluster) {
        context.skip('No uniquely named managed AKS cluster in the current subscription.');
        return;
      }
      expect(typeof cluster.name).toBe('string');
      const info = await readLive(() => getClusterInfo(cluster.name));
      expect(info.clusterName === cluster.name).toBe(true);
      expect(info.resourceGroup === cluster.resourceGroup).toBe(true);
      expect(info.subscriptionId === subscription).toBe(true);

      const identity = await readLive(() =>
        getClusterResourceIdAndGroup(cluster.name, subscription)
      );
      expect(identity !== null).toBe(true);
      expect(typeof identity?.resourceId).toBe('string');
      expect(identity?.resourceGroup === cluster.resourceGroup).toBe(true);
      expect(
        identity?.resourceId
          .toLowerCase()
          .endsWith(`/managedclusters/${cluster.name.toLowerCase()}`)
      ).toBe(true);
    } finally {
      graphList.mockRestore();
      graphGroup.mockRestore();
    }
  });
});
