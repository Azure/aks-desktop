// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Live tests comparing REST results with the equivalent `az` commands.
 * Require a logged-in `az` and AZ_LIVE_TESTS=1; AZ_LIVE_SUBSCRIPTION is optional.
 */

import { spawn } from 'node:child_process';
import { beforeAll, describe, expect, test } from 'vitest';
import { azListAll, azRequest } from './az-http';
import { ARM_SCOPE, getAzToken } from './az-token';

const LIVE = process.env.AZ_LIVE_TESTS === '1';

function az(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('az', args, { shell: process.platform === 'win32' });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d));
    child.stderr.on('data', (d: Buffer) => (err += d));
    child.on('error', reject);
    child.on('close', (code: number | null) =>
      code === 0 ? resolve(out) : reject(new Error(err))
    );
  });
}

const ids = (items: Array<{ id: string }>) => items.map(i => i.id.toLowerCase()).sort();

describe.runIf(LIVE)('Azure REST transport (live, parity with az)', { timeout: 120_000 }, () => {
  let subscription: string;
  let tenant: string;

  beforeAll(async () => {
    // Stand-in for Headlamp's `pluginRunCommand`, backed by a real child process.
    (globalThis as any).pluginRunCommand = (cmd: string, args: string[]) => {
      const child = spawn(cmd, args, { shell: process.platform === 'win32' });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      return child;
    };
    const args = ['account', 'show', '-o', 'json'];
    if (process.env.AZ_LIVE_SUBSCRIPTION)
      args.push('--subscription', process.env.AZ_LIVE_SUBSCRIPTION);
    const account = JSON.parse(await az(args));
    subscription = account.id;
    tenant = account.tenantId;
  });

  test('acquires ARM tokens for the default and explicit tenant', async () => {
    const token = await getAzToken();
    expect(token.token.length).toBeGreaterThan(100);
    expect(token.expiresOnTimestamp).toBeGreaterThan(Date.now());
    expect((await getAzToken(ARM_SCOPE, { tenantId: tenant })).token).toBeTruthy();
  });

  test('resource groups match `az group list`', async () => {
    const [rest, cli] = await Promise.all([
      azListAll<{ id: string }>({
        url: `/subscriptions/${subscription}/resourcegroups`,
        apiVersion: '2021-04-01',
        tenantId: tenant,
      }),
      az(['group', 'list', '--subscription', subscription, '-o', 'json']).then(JSON.parse),
    ]);
    expect(ids(rest)).toEqual(ids(cli));
  });

  test('AKS clusters match `az aks list`', async () => {
    const [rest, cli] = await Promise.all([
      azListAll<{ id: string }>({
        url: `/subscriptions/${subscription}/providers/Microsoft.ContainerService/managedClusters`,
        apiVersion: '2024-09-01',
        tenantId: tenant,
      }),
      az(['aks', 'list', '--subscription', subscription, '-o', 'json']).then(JSON.parse),
    ]);
    expect(ids(rest)).toEqual(ids(cli));
  });

  test('surfaces ARM errors with code and request ID', async () => {
    const error: any = await azRequest({
      url: `/subscriptions/${subscription}/resourcegroups/aks-desktop-missing-${Date.now()}`,
      apiVersion: '2021-04-01',
      tenantId: tenant,
    }).catch(e => e);
    expect(error).toMatchObject({ status: 404, code: 'ResourceGroupNotFound' });
    expect(error.requestId).toBeTruthy();
  });
});
