// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Read-only live checks that subscription discovery records the CLI account's tenant, keeps
 * every enabled subscription `az aks list` can read, and that all-subscription cluster discovery
 * lists the same clusters as `az aks list`. Require a logged-in `az` and AZ_LIVE_TESTS=1.
 * Nothing is created.
 *
 * Discovery checks cover every subscription. Cluster listing runs per subscription and takes
 * minutes for accounts with hundreds of them, so it is checked on a sample: the current
 * subscription plus others spread across tenants, up to SAMPLE_SIZE.
 *
 * The last case runs only when a subscription's listing tenant differs from its CLI profile
 * tenant, for example when the profile tenant's own listing failed. Ordinary accounts don't
 * produce that, Lighthouse included (az records the listing tenant for delegated subscriptions),
 * so it usually skips; the unit test covers that branch.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { getClusters } from './az-clusters';
import * as subscriptionModule from './az-subscriptions';

const LIVE = process.env.AZ_LIVE_TESTS === '1' && !process.env.CI;
const SAMPLE_SIZE = 8;
const CONCURRENCY = 8;
const COMMAND_TIMEOUT_MS = 120_000;
const SETUP_DEADLINE_MS = 540_000;
/** An `az` call stopped after COMMAND_TIMEOUT_MS or by the setup deadline: inconclusive. */
const TIMED_OUT = Symbol('timed out');

/** Set by the setup deadline; stops new probes and setup steps. */
let aborted = false;
/** Running `az` children started by this suite, killed when the deadline fires. */
const children = new Set<ChildProcess>();

/** Stops setup after the deadline: no new work starts and running `az` children are killed. */
function abort() {
  aborted = true;
  for (const child of children) child.kill('SIGKILL');
}

/** Azure errors may contain account or resource identifiers; never send them to the reporter. */
async function readLive<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    throw new Error('Live Azure read failed; check the current az login and read permissions.');
  }
}

/**
 * Runs a read-only `az` command, killing it after COMMAND_TIMEOUT_MS. On Windows the child is
 * the shell that runs `az`, so a killed shell may leave `az` itself running.
 * @returns Its parsed JSON output, undefined if it fails, or TIMED_OUT. Errors are not kept,
 * since they may contain account or resource identifiers.
 */
function az(args: string[]): Promise<any> {
  if (aborted) return Promise.resolve(TIMED_OUT);
  return new Promise(resolve => {
    const child = spawn('az', [...args, '-o', 'json'], { shell: process.platform === 'win32' });
    children.add(child);
    const finish = (result: unknown) => {
      clearTimeout(timer);
      children.delete(child);
      resolve(result);
    };
    // Settle at the limit instead of waiting for a stuck child to close its pipes.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(TIMED_OUT);
    }, COMMAND_TIMEOUT_MS);
    let out = '';
    child.stdout.on('data', (data: Buffer) => (out += data));
    // Drain stderr so a noisy command can't block on a full pipe.
    child.stderr.resume();
    child.on('error', () => finish(undefined));
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal) return finish(TIMED_OUT);
      try {
        finish(code === 0 ? JSON.parse(out) : undefined);
      } catch {
        finish(undefined);
      }
    });
  });
}

/**
 * @returns Lowercased cluster IDs `az aks list` returns for a subscription, undefined if it
 * can't read them, or TIMED_OUT.
 */
async function azClusterIds(
  subscriptionId: string
): Promise<Set<string> | undefined | typeof TIMED_OUT> {
  const ids = await az(['aks', 'list', '--subscription', subscriptionId, '--query', '[].id']);
  if (ids === TIMED_OUT) return TIMED_OUT;
  return Array.isArray(ids) ? new Set(ids.map(lower) as string[]) : undefined;
}

/**
 * Maps items with at most CONCURRENCY calls in flight, reporting progress after each. Stops
 * starting new calls once setup is aborted; unstarted results stay undefined.
 */
async function mapLimit<T, R>(
  items: T[],
  map: (item: T) => Promise<R>,
  onProgress: (done: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (!aborted && next < items.length) {
      const index = next++;
      results[index] = await map(items[index]);
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

const lower = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : undefined);

/**
 * Picks discovered subscriptions to list clusters for: the current subscription, then
 * other-tenant ones, then one per tenant in turn, up to SAMPLE_SIZE.
 */
function pickSample(subscriptions: any[], currentId: string | undefined): any[] {
  const enabled = subscriptions.filter(sub => sub.status === 'Enabled');
  const sample: any[] = [];
  const add = (sub: any) => {
    if (sample.length < SAMPLE_SIZE && !sample.includes(sub)) sample.push(sub);
  };
  enabled.filter(sub => lower(sub.id) === currentId).forEach(add);
  enabled
    .filter(sub => sub.accountTenantId && lower(sub.tenant) !== sub.accountTenantId)
    .forEach(add);
  const byTenant = new Map<string, any[]>();
  for (const sub of enabled) {
    const tenant = lower(sub.accountTenantId ?? sub.tenant)!;
    byTenant.set(tenant, [...(byTenant.get(tenant) ?? []), sub]);
  }
  for (let round = 0; sample.length < SAMPLE_SIZE; round++) {
    const picks = [...byTenant.values()].map(subs => subs[round]).filter(Boolean);
    if (picks.length === 0) break;
    picks.forEach(add);
  }
  return sample;
}

describe.runIf(LIVE)('subscription tenant provenance (live, read-only)', () => {
  let subscriptions: any[];
  /** CLI profile tenant by lowercased subscription ID. */
  let profileTenants: Map<string, string | undefined>;
  /** Enabled profile subscriptions discovery missed that `az aks list` could read. */
  let readableButUndiscovered: number;
  /** Probes of undiscovered subscriptions that timed out, leaving them inconclusive. */
  let undiscoveredTimeouts: number;
  /** Discovered subscriptions that all-subscription cluster discovery ran on. */
  let sample: any[];
  /** Lowercased cluster IDs from `az aks list`, for sampled subscriptions it could read. */
  let azClusters: Map<string, Set<string>>;
  /** Sampled `az aks list` probes that timed out, leaving those subscriptions inconclusive. */
  let sampleTimeouts: number;
  /** Lowercased cluster IDs from all-subscription `getClusters()`, by subscription. */
  let listedClusters: Map<string, Set<string>>;
  /** Lowercased subscription IDs whose managed-cluster list `getClusters()` requested. */
  let listRequested: Set<string>;
  /** Lowercased subscription IDs named in a `getClusters()` warning, i.e. skipped. */
  let warned: Set<string>;
  let fetchSpy: { mockRestore(): void };

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
      // runCommandAsync reports this as a failed command.
      if (aborted) throw new Error('Live setup was aborted.');
      const child = spawn(cmd, args, { shell: process.platform === 'win32' });
      children.add(child);
      child.on('close', () => children.delete(child));
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      return child;
    });

    // Pass-through fetch spy that records which subscriptions' cluster lists were requested.
    listRequested = new Set();
    const realFetch = globalThis.fetch;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname.toLowerCase();
      const match = path.match(
        /^\/subscriptions\/([^/]+)\/providers\/microsoft\.containerservice\/managedclusters$/
      );
      // Subscription IDs are GUIDs, so the path segment needs no decoding.
      if (match) listRequested.add(match[1]);
      return realFetch(input, init);
    });

    // Progress uses counts only, so a deadline failure names the slow step without identifiers.
    let progress = 'subscription discovery';
    const setup = async () => {
      subscriptions = await readLive(() => subscriptionModule.getSubscriptions());
      // Read the profile after discovery, which may have refreshed it.
      progress = 'reading the CLI profile';
      const profile = await az(['account', 'list', '--all']);
      if (!Array.isArray(profile) || subscriptions.length === 0) {
        throw new Error('Live tests require an existing az login with at least one subscription.');
      }
      profileTenants = new Map(profile.map((s: any) => [lower(s.id)!, lower(s.tenantId)]));

      const discovered = new Set(subscriptions.map(sub => lower(sub.id)));
      const undiscovered = profile.filter(
        (s: any) => s.state === 'Enabled' && !discovered.has(lower(s.id))
      );
      progress = `az aks list for undiscovered subscriptions (0/${undiscovered.length})`;
      const undiscoveredClusters = await mapLimit(
        undiscovered,
        (s: any) => azClusterIds(s.id),
        done =>
          (progress = `az aks list for undiscovered subscriptions (${done}/${undiscovered.length})`)
      );
      readableButUndiscovered = undiscoveredClusters.filter(ids => ids instanceof Set).length;
      undiscoveredTimeouts = undiscoveredClusters.filter(ids => ids === TIMED_OUT).length;

      if (aborted) return;
      progress = 'reading the current subscription';
      const current = await az(['account', 'show']);
      if (typeof current?.id !== 'string') {
        throw new Error('Live tests require a current az subscription.');
      }
      sample = pickSample(subscriptions, lower(current.id));
      progress = `az aks list for sampled subscriptions (0/${sample.length})`;
      const sampleClusters = await mapLimit(
        sample,
        sub => azClusterIds(sub.id),
        done => (progress = `az aks list for sampled subscriptions (${done}/${sample.length})`)
      );
      azClusters = new Map();
      sample.forEach((sub, index) => {
        const ids = sampleClusters[index];
        if (ids instanceof Set) azClusters.set(lower(sub.id)!, ids);
      });
      sampleTimeouts = sampleClusters.filter(ids => ids === TIMED_OUT).length;

      // Run all-subscription discovery on the sampled, real discovery records.
      if (aborted) return;
      progress = `getClusters() over ${sample.length} sampled subscriptions`;
      const discover = vi.spyOn(subscriptionModule, 'getSubscriptions').mockResolvedValue(sample);
      warn.mockClear();
      listRequested.clear();
      try {
        const clusters = await readLive(() => getClusters());
        listedClusters = new Map();
        for (const cluster of clusters) {
          const key = lower(cluster.subscription)!;
          listedClusters.set(key, (listedClusters.get(key) ?? new Set()).add(lower(cluster.id)!));
        }
      } finally {
        discover.mockRestore();
      }
      const warnings = warn.mock.calls.map(call => call.map(String).join(' ').toLowerCase());
      warned = new Set(
        sample.map(sub => lower(sub.id)!).filter(id => warnings.some(w => w.includes(id)))
      );
    };

    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        setup(),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => {
            abort();
            reject(
              new Error(
                `Live setup exceeded ${SETUP_DEADLINE_MS / 60_000} minutes during ${progress}.`
              )
            );
          }, SETUP_DEADLINE_MS);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
  }, 600_000);

  afterAll(() => {
    abort();
    fetchSpy?.mockRestore();
    vi.unstubAllGlobals();
    // Console stays muted: production work from an aborted setup may still be in flight.
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

  test('subscription discovery keeps every enabled subscription az aks list can read', () => {
    expect(undiscoveredTimeouts).toBe(0);
    expect(readableButUndiscovered).toBe(0);
  });

  test('all-subscription cluster discovery matches az aks list for sampled subscriptions', () => {
    const readable = [...azClusters.keys()];
    // Also catches a subscription with no clusters that discovery never queried.
    const dropped = readable.filter(id => warned.has(id) || !listRequested.has(id));
    const different = readable.filter(id => {
      const expected = azClusters.get(id)!;
      const listed = listedClusters.get(id) ?? new Set<string>();
      return expected.size !== listed.size || [...expected].some(cluster => !listed.has(cluster));
    });

    expect(sampleTimeouts).toBe(0);
    expect(readable.length).toBeGreaterThan(0);
    expect(dropped.length).toBe(0);
    expect(different.length).toBe(0);
  });

  test('keeps subscriptions whose listing tenant differs from the CLI profile tenant', context => {
    const otherTenant = sample.filter(
      sub => sub.accountTenantId && lower(sub.tenant) !== lower(sub.accountTenantId)
    );
    if (otherTenant.length === 0) {
      context.skip('No subscription listed through a tenant other than its CLI profile tenant.');
      return;
    }
    const readable = otherTenant.filter(sub => azClusters.has(lower(sub.id)!));
    if (readable.length === 0) {
      context.skip('az aks list could not read any sampled other-tenant subscription.');
      return;
    }
    const dropped = readable.filter(
      sub => warned.has(lower(sub.id)!) || !listRequested.has(lower(sub.id)!)
    );

    expect(dropped.length).toBe(0);
  });
});
