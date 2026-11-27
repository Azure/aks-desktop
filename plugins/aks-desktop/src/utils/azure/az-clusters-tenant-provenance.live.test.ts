// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Read-only live checks that subscription discovery records the CLI account's tenant and that
 * all-subscription cluster discovery keeps every subscription `az aks list` can read.
 * Require a logged-in `az` and AZ_LIVE_TESTS=1. Nothing is created.
 *
 * A single-tenant account covers the account-tenant mapping and the no-skip check. The
 * delegated (Lighthouse) path, where the tenant that lists a subscription differs from its CLI
 * account tenant, is only exercised when the signed-in account has a delegated subscription;
 * otherwise that case reports as skipped.
 */

import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { getClusters } from './az-clusters';
import { getSubscriptions } from './az-subscriptions';

const LIVE = process.env.AZ_LIVE_TESTS === '1' && !process.env.CI;

/** Azure errors may contain account or resource identifiers; never send them to the reporter. */
async function readLive<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    throw new Error('Live Azure read failed; check the current az login and read permissions.');
  }
}

/**
 * Runs a read-only `az` command.
 * @returns Its parsed JSON output, or undefined if it fails. Errors are not kept, since they
 * may contain account or resource identifiers.
 */
function az(args: string[]): Promise<any> {
  return new Promise(resolve => {
    const child = spawn('az', [...args, '-o', 'json'], { shell: process.platform === 'win32' });
    let out = '';
    child.stdout.on('data', (data: Buffer) => (out += data));
    child.on('error', () => resolve(undefined));
    child.on('close', (code: number | null) => {
      try {
        resolve(code === 0 ? JSON.parse(out) : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

const lower = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : undefined);

describe.runIf(LIVE)('subscription tenant provenance (live, read-only)', () => {
  let subscriptions: any[];
  /** CLI profile tenant by lowercased subscription ID. */
  let profileTenants: Map<string, string | undefined>;
  /** Lowercased cluster IDs from `az aks list`, for enabled profile subscriptions it could read. */
  let azClusters: Map<string, Set<string>>;
  /** Lowercased cluster IDs from all-subscription `getClusters()`, by subscription. */
  let listedClusters: Map<string, Set<string>>;
  /** Lowercased subscription IDs whose managed-cluster list `getClusters()` requested. */
  let listRequested: Set<string>;
  /** Lowercased subscription IDs named in a `getClusters()` warning, i.e. skipped. */
  let warned: Set<string>;

  beforeAll(async () => {
    // Production warnings and debug output include Azure identifiers; keep them off the reporter.
    for (const method of ['debug', 'log', 'info', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation(() => {});
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('pluginRunCommand', (cmd: string, args: string[]) => {
      const operation = args.slice(0, 2).join(' ');
      if (
        cmd !== 'az' ||
        !['account list', 'account show', 'account get-access-token', 'cloud show'].includes(
          operation
        )
      ) {
        throw new Error('Only read-only Azure account commands are allowed in this suite.');
      }
      const child = spawn(cmd, args, { shell: process.platform === 'win32' });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      return child;
    });

    // Pass-through fetch spy that records which subscriptions' cluster lists were requested.
    listRequested = new Set();
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname.toLowerCase();
      const match = path.match(
        /^\/subscriptions\/([^/]+)\/providers\/microsoft\.containerservice\/managedclusters$/
      );
      // Subscription IDs are GUIDs, so the path segment needs no decoding.
      if (match) listRequested.add(match[1]);
      return realFetch(input, init);
    });
    subscriptions = await readLive(() => getSubscriptions());
    // Read the profile after discovery, which may have refreshed it.
    const profile = await az(['account', 'list', '--all']);
    if (!Array.isArray(profile) || subscriptions.length === 0) {
      throw new Error('Live tests require an existing az login with at least one subscription.');
    }
    profileTenants = new Map(profile.map((s: any) => [lower(s.id)!, lower(s.tenantId)]));

    // The baseline comes from the CLI profile, so a subscription discovery drops still counts.
    azClusters = new Map();
    for (const sub of profile.filter((s: any) => s.state === 'Enabled')) {
      const ids = await az(['aks', 'list', '--subscription', sub.id, '--query', '[].id']);
      if (Array.isArray(ids)) azClusters.set(lower(sub.id)!, new Set(ids.map(lower)));
    }

    warn.mockClear();
    listRequested.clear();
    const clusters = await readLive(() => getClusters());
    listedClusters = new Map();
    for (const cluster of clusters) {
      const key = lower(cluster.subscription)!;
      listedClusters.set(key, (listedClusters.get(key) ?? new Set()).add(lower(cluster.id)!));
    }
    const warnings = warn.mock.calls.map(call => call.map(String).join(' ').toLowerCase());
    warned = new Set(
      [...azClusters.keys()].filter(id => warnings.some(warning => warning.includes(id)))
    );
  }, 600_000);

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Assertions compare counts and booleans so failures don't print identifiers.

  test("records each subscription's CLI profile tenant as accountTenantId", () => {
    const known = subscriptions.filter(sub => profileTenants.get(lower(sub.id)!));
    const mismatched = known.filter(
      sub => lower(sub.accountTenantId) !== profileTenants.get(lower(sub.id)!)
    );

    expect(known.length).toBeGreaterThan(0);
    expect(mismatched.length).toBe(0);
  });

  test('all-subscription discovery keeps every subscription az aks list can read', () => {
    const readable = [...azClusters.keys()];
    // Also catches a subscription with no clusters that discovery never queried.
    const dropped = readable.filter(id => warned.has(id) || !listRequested.has(id));
    const different = readable.filter(id => {
      const expected = azClusters.get(id)!;
      const listed = listedClusters.get(id) ?? new Set<string>();
      return expected.size !== listed.size || [...expected].some(cluster => !listed.has(cluster));
    });

    expect(readable.length).toBeGreaterThan(0);
    expect(dropped.length).toBe(0);
    expect(different.length).toBe(0);
  });

  test('keeps delegated subscriptions listed through another tenant', context => {
    const delegated = subscriptions.filter(
      sub => sub.accountTenantId && lower(sub.tenant) !== lower(sub.accountTenantId)
    );
    if (delegated.length === 0) {
      context.skip('No delegated subscription in this account; the delegated path did not run.');
      return;
    }
    const readable = delegated.filter(sub => azClusters.has(lower(sub.id)!));
    const dropped = readable.filter(
      sub => warned.has(lower(sub.id)!) || !listRequested.has(lower(sub.id)!)
    );

    expect(readable.length).toBeGreaterThan(0);
    expect(dropped.length).toBe(0);
  });
});
