// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunCommandAsync = vi.fn();
vi.mock('./az-cli-core', () => ({
  runCommandAsync: (...args: unknown[]) => mockRunCommandAsync(...args),
  runAzCommand: vi.fn(),
  debugLog: vi.fn(),
  isValidGuid: (s: string) => /^[0-9a-f-]{36}$/.test(s),
  isAzError: () => false,
  needsRelogin: () => false,
}));

vi.mock('./az-validation', () => ({
  isValidAzResourceName: (s: string) => /^[a-zA-Z0-9-_]+$/.test(s),
}));

import { getSubscriptions } from './az-subscriptions';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

/**
 * Route `az account list` / `az account tenant list` to the supplied payloads.
 * `tenantResult` may be an Error to simulate the tenant call failing.
 */
function mockAz(accounts: any[], tenantResult: any[] | Error = []) {
  mockRunCommandAsync.mockImplementation(async (cmd: string, args: string[]) => {
    if (args[0] === 'account' && args[1] === 'tenant' && args[2] === 'list') {
      if (tenantResult instanceof Error) throw tenantResult;
      return { stdout: JSON.stringify(tenantResult), stderr: '' };
    }
    if (args[0] === 'account' && args[1] === 'list') {
      return { stdout: JSON.stringify(accounts), stderr: '' };
    }
    // Fail loudly rather than silently serving the account payload for a
    // command these tests never intended to exercise.
    throw new Error(`Unexpected az command: ${cmd} ${args.join(' ')}`);
  });
}

function tenantListCalls() {
  return mockRunCommandAsync.mock.calls.filter(call => call[1][1] === 'tenant');
}

describe('getSubscriptions tenant name resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps tenantDisplayName and skips the tenant lookup when every name is present', async () => {
    mockAz([
      {
        id: 'sub-1',
        name: 'Prod',
        tenantId: TENANT_A,
        tenantDisplayName: 'Contoso',
        state: 'Enabled',
      },
    ]);

    const subs = await getSubscriptions();

    expect(subs[0].tenantName).toBe('Contoso');
    expect(tenantListCalls()).toHaveLength(0);
  });

  it('returns all cached subscriptions without requesting a server refresh', async () => {
    mockAz([
      {
        id: 'cached-sub-id',
        name: 'Cached Subscription',
        tenantId: TENANT_A,
        tenantDisplayName: 'Microsoft',
        state: 'Enabled',
      },
    ]);

    await getSubscriptions();

    expect(mockRunCommandAsync).toHaveBeenCalledWith('az', [
      'account',
      'list',
      '--all',
      '-o',
      'json',
    ]);
  });

  it('refreshes all subscriptions before returning a selected-tenant subscription', async () => {
    mockAz([
      {
        id: 'refreshed-sub-id',
        name: 'Refreshed Subscription',
        tenantId: TENANT_A,
        tenantDisplayName: 'Microsoft',
        state: 'Enabled',
      },
    ]);

    await expect(getSubscriptions(true)).resolves.toEqual([
      {
        id: 'refreshed-sub-id',
        name: 'Refreshed Subscription',
        tenant: TENANT_A,
        tenantName: 'Microsoft',
        status: 'Enabled',
      },
    ]);
    expect(mockRunCommandAsync).toHaveBeenCalledWith('az', [
      'account',
      'list',
      '--all',
      '--refresh',
      '-o',
      'json',
    ]);
  });

  it('resolves a missing tenantDisplayName from az account tenant list', async () => {
    mockAz(
      [
        {
          id: 'sub-1',
          name: 'Prod',
          tenantId: TENANT_A,
          tenantDisplayName: 'Contoso',
          state: 'Enabled',
        },
        { id: 'sub-2', name: 'Guest', tenantId: TENANT_B, state: 'Enabled' },
      ],
      [
        { tenantId: TENANT_A, displayName: 'Contoso' },
        { tenantId: TENANT_B, displayName: 'Fabrikam', domains: ['fabrikam.com'] },
      ]
    );

    const subs = await getSubscriptions();

    expect(subs.map(s => s.tenantName)).toEqual(['Contoso', 'Fabrikam']);
    expect(tenantListCalls()).toHaveLength(1);
  });

  it('falls back to the tenant domain when the tenant has no displayName', async () => {
    mockAz(
      [{ id: 'sub-1', name: 'Guest', tenantId: TENANT_B, state: 'Enabled' }],
      [{ tenantId: TENANT_B, domains: ['fabrikam.onmicrosoft.com'] }]
    );

    const subs = await getSubscriptions();

    expect(subs[0].tenantName).toBe('fabrikam.onmicrosoft.com');
  });

  it('leaves tenantName undefined when the tenant list omits the tenant', async () => {
    mockAz(
      [{ id: 'sub-1', name: 'Guest', tenantId: TENANT_B, state: 'Enabled' }],
      [{ tenantId: TENANT_A, displayName: 'Contoso' }]
    );

    const subs = await getSubscriptions();

    expect(subs[0].tenantName).toBeUndefined();
    expect(subs[0].tenant).toBe(TENANT_B);
  });

  it('leaves tenantName undefined when the tenant has neither displayName nor domain', async () => {
    mockAz(
      [{ id: 'sub-1', name: 'Guest', tenantId: TENANT_B, state: 'Enabled' }],
      [{ tenantId: TENANT_B }]
    );

    const subs = await getSubscriptions();

    expect(subs[0].tenantName).toBeUndefined();
  });

  it('still returns subscriptions when az account tenant list fails', async () => {
    mockAz(
      [{ id: 'sub-1', name: 'Guest', tenantId: TENANT_B, state: 'Enabled' }],
      new Error('Please run "az login"')
    );

    const subs = await getSubscriptions();

    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      id: 'sub-1',
      name: 'Guest',
      tenant: TENANT_B,
      status: 'Enabled',
    });
    expect(subs[0].tenantName).toBeUndefined();
  });

  it('still throws when az account list itself returns nothing', async () => {
    mockRunCommandAsync.mockResolvedValue({ stdout: '', stderr: 'az: command failed' });

    await expect(getSubscriptions()).rejects.toThrow('az: command failed');
  });
});
