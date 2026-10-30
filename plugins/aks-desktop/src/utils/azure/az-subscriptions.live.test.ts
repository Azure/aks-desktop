// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Read-only live tests comparing subscription discovery and resource group lookups with `az`.
 * Require a logged-in `az` and AZ_LIVE_TESTS=1; AZ_LIVE_SUBSCRIPTION is optional.
 * Resource group creation is not tested live because it needs run-owned cleanup.
 */

import { spawn } from 'node:child_process';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  getResourceGroupLocation,
  getSubscriptions,
  resourceGroupExists,
} from './az-subscriptions';

const LIVE = process.env.AZ_LIVE_TESTS === '1';

/** Runs an `az` command and returns its parsed JSON output. */
function az(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn('az', [...args, '-o', 'json'], { shell: process.platform === 'win32' });
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

describe.runIf(LIVE)('subscription discovery (live, parity with az)', { timeout: 180_000 }, () => {
  let account: { id: string; tenantId: string };
  let subscriptions: Awaited<ReturnType<typeof getSubscriptions>>;

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
    account = await az(args);
    subscriptions = await getSubscriptions();
  }, 180_000);

  test('getSubscriptions returns the selected subscription with ARM fields mapped', () => {
    expect(subscriptions.find(s => s.id === account.id)).toMatchObject({
      id: account.id,
      tenant: account.tenantId,
      status: 'Enabled',
      tenantName: expect.any(String),
    });
  });

  test('getSubscriptions results agree with cached `az account list --all`', async () => {
    // Without --refresh, az reads its cache and does not re-authenticate every tenant.
    // Tenants that fail with REST are skipped, so only check what REST returned.
    const cli = new Map<string, any>(
      (await az(['account', 'list', '--all'])).map((s: any) => [s.id, s])
    );
    expect(new Set(subscriptions.map(s => s.id)).size).toBe(subscriptions.length);
    for (const sub of subscriptions.filter(s => cli.has(s.id))) {
      expect(sub).toMatchObject({
        tenant: cli.get(sub.id).tenantId,
        status: cli.get(sub.id).state,
      });
    }
  });

  test('resource group lookups match `az group show/exists`', async () => {
    const [group] = await az(['group', 'list', '--subscription', account.id]);
    if (!group) return;
    const options = { resourceGroupName: group.name, subscriptionId: account.id };

    expect(await getResourceGroupLocation(options)).toBe(group.location);
    expect(await resourceGroupExists(options)).toEqual({ exists: true });
    expect(
      await resourceGroupExists({
        ...options,
        resourceGroupName: `aks-desktop-missing-${Date.now()}`,
      })
    ).toEqual({ exists: false });
  });

  test('missing resource groups surface as location errors', async () => {
    await expect(
      getResourceGroupLocation({
        resourceGroupName: `aks-desktop-missing-${Date.now()}`,
        subscriptionId: account.id,
      })
    ).rejects.toThrow('ResourceGroupNotFound');
  });
});
