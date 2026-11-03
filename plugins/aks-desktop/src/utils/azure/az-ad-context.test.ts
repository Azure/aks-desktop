// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ command: vi.fn(), fetch: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));
vi.mock('./az-cli-path', () => ({ getAzCommand: () => 'az' }));

import { resolveAzureADUser, searchAzureADUsers } from './az-ad';

const subscriptionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const tenantId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const user = {
  id: '11111111-2222-3333-4444-555555555555',
  displayName: 'Alice',
  mail: null,
  userPrincipalName: 'alice@contoso.com',
};
let account: {
  id: string;
  tenantId: string;
  cloudName?: string;
  environmentName?: string;
  user: { name: string };
};
let resources: Record<string, unknown>;
let loggedIn: boolean;
let tokenCount: number;
let requests: { url: string; authorization: string }[];

function output(data: unknown) {
  return { stdout: JSON.stringify(data), stderr: '' };
}

function calls(operation: string) {
  return mocks.command.mock.calls.filter(([, args]) => args.slice(0, 2).join(' ') === operation);
}

beforeEach(() => {
  window.dispatchEvent(new CustomEvent('azure-auth-update'));
  account = {
    id: subscriptionId,
    tenantId,
    cloudName: 'AzureCloud',
    user: { name: 'operator-a@contoso.com' },
  };
  resources = {
    AzureCloud: 'https://graph.microsoft.com/',
    AzureUSGovernment: 'https://graph.microsoft.us',
    AzureChinaCloud: 'https://microsoftgraph.chinacloudapi.cn/',
  };
  loggedIn = true;
  tokenCount = 0;
  requests = [];
  mocks.command.mockReset().mockImplementation(async (command: string, args: string[]) => {
    expect(command).toBe('az');
    if (args[0] === 'account' && args[1] === 'show') {
      expect(args).toEqual(['account', 'show', '-o', 'json']);
      return loggedIn ? output(account) : { stdout: '', stderr: 'ERROR: Please run az login' };
    }
    if (args[0] === 'cloud' && args[1] === 'show') {
      expect(args).toEqual([
        'cloud',
        'show',
        '--name',
        account.cloudName ?? account.environmentName,
        '--output',
        'json',
      ]);
      return output({
        endpoints: {
          microsoftGraphResourceId: resources[args[3]],
          activeDirectoryGraphResourceId: 'https://legacy-graph.invalid/',
        },
      });
    }
    if (args[0] === 'account' && args[1] === 'get-access-token') {
      expect(args).toEqual([
        'account',
        'get-access-token',
        '--scope',
        expect.any(String),
        '-o',
        'json',
        '--subscription',
        account.id,
      ]);
      tokenCount++;
      return output({
        accessToken: `offline-${account.user.name}-${tokenCount}`,
        expires_on: Math.floor(Date.now() / 1000) + 3600,
        tenant: account.tenantId,
      });
    }
    throw new Error(`Unexpected CLI command: ${args.join(' ')}`);
  });
  mocks.fetch.mockReset().mockImplementation(async (url: string, options: RequestInit) => {
    requests.push({
      url: String(url),
      authorization: (options.headers as Record<string, string>).Authorization,
    });
    const body = new URL(url).pathname.endsWith('/v1.0/users') ? { value: [user] } : user;
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Graph account and cloud context', () => {
  test('checks the current account on every lookup while reusing its valid token', async () => {
    expect((await searchAzureADUsers('Alice')).success).toBe(true);
    expect((await resolveAzureADUser(user.id)).success).toBe(true);
    expect((await searchAzureADUsers('Alice')).success).toBe(true);
    expect(calls('account show')).toHaveLength(3);
    expect(calls('cloud show')).toHaveLength(1);
    expect(calls('account get-access-token')).toHaveLength(1);
    expect(new Set(requests.map(request => request.authorization)).size).toBe(1);
  });

  test('immediately replaces credentials on external user changes in the same subscription and tenant', async () => {
    await searchAzureADUsers('Alice');
    account.user.name = 'operator-b@contoso.com';
    await resolveAzureADUser(user.id);
    account.user.name = 'operator-a@contoso.com';
    await searchAzureADUsers('Alice');
    expect(tokenCount).toBe(3);
    expect(requests.map(request => request.authorization)).toEqual([
      'Bearer offline-operator-a@contoso.com-1',
      'Bearer offline-operator-b@contoso.com-2',
      'Bearer offline-operator-a@contoso.com-3',
    ]);
  });

  test('refreshes for external tenant, subscription and cloud changes without waiting for a poll', async () => {
    await searchAzureADUsers('Alice');
    account.tenantId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    await resolveAzureADUser(user.id);
    account.id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    await searchAzureADUsers('Alice');
    account.cloudName = 'AzureUSGovernment';
    await resolveAzureADUser(user.id);
    expect(tokenCount).toBe(4);
    expect(calls('account show')).toHaveLength(4);
    expect(new Set(requests.map(request => request.authorization)).size).toBe(4);
    expect(new URL(requests[3].url).origin).toBe('https://graph.microsoft.us');
    expect(calls('account get-access-token').at(-1)![1]).toContain(account.id);
  });

  test.each([
    ['AzureCloud', 'https://graph.microsoft.com'],
    ['AzureUSGovernment', 'https://graph.microsoft.us'],
    ['AzureChinaCloud', 'https://microsoftgraph.chinacloudapi.cn'],
  ])('uses the configured Microsoft Graph endpoint and audience in %s', async (cloud, endpoint) => {
    account.cloudName = cloud;
    expect(await searchAzureADUsers('Alice')).toEqual({ success: true, users: [user] });
    expect(await resolveAzureADUser(user.userPrincipalName)).toEqual({ success: true, user });
    expect(requests.every(request => request.url.startsWith(`${endpoint}/v1.0/users`))).toBe(true);
    expect(calls('account get-access-token')[0][1][3]).toBe(`${endpoint}/.default`);
    expect(calls('cloud show')).toHaveLength(1);
  });

  test('supports the legacy environmentName account field without reading the active cloud', async () => {
    delete account.cloudName;
    account.environmentName = 'AzureChinaCloud';
    expect((await searchAzureADUsers('Alice')).success).toBe(true);
    expect(new URL(requests[0].url).origin).toBe('https://microsoftgraph.chinacloudapi.cn');
    expect(calls('cloud show')[0][1][3]).toBe('AzureChinaCloud');
  });

  test('preserves a custom cloud resource path in requests and the matching scope', async () => {
    account.cloudName = 'CustomCloud';
    resources.CustomCloud = 'https://directory.example.com/graph/';
    expect((await searchAzureADUsers('Alice')).success).toBe(true);
    expect(new URL(requests[0].url).pathname).toBe('/graph/v1.0/users');
    expect(calls('account get-access-token')[0][1][3]).toBe(
      'https://directory.example.com/graph/.default'
    );
  });

  test('external logout fails before token acquisition or HTTP, even with a cached token', async () => {
    await searchAzureADUsers('Alice');
    loggedIn = false;
    for (const lookup of [() => searchAzureADUsers('Alice'), () => resolveAzureADUser(user.id)]) {
      expect(await lookup()).toMatchObject({
        success: false,
        error: expect.stringContaining('login'),
      });
    }
    expect(tokenCount).toBe(1);
    expect(requests).toHaveLength(1);
  });

  test.each(['cloud', 'username', 'blank username'])(
    'fails closed for a known account missing its %s',
    async field => {
      if (field === 'cloud') delete account.cloudName;
      else account.user.name = field === 'username' ? '' : '   ';
      expect(await searchAzureADUsers('Alice')).toMatchObject({
        success: false,
        users: [],
        error: expect.stringContaining('missing'),
      });
      expect(calls('cloud show')).toHaveLength(0);
      expect(tokenCount).toBe(0);
      expect(requests).toHaveLength(0);
    }
  );

  test('rejects a token issued for another tenant before HTTP', async () => {
    const dispatch = mocks.command.getMockImplementation()!;
    mocks.command.mockImplementation((command: string, args: string[]) =>
      args[1] === 'get-access-token'
        ? Promise.resolve(
            output({
              accessToken: 'offline-wrong-tenant',
              expires_on: Math.floor(Date.now() / 1000) + 3600,
              tenant: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            })
          )
        : dispatch(command, args)
    );
    expect(await resolveAzureADUser(user.id)).toMatchObject({
      success: false,
      error: expect.stringContaining('does not belong to the requested tenant'),
    });
    expect(requests).toHaveLength(0);
  });

  test.each([
    undefined,
    '',
    42,
    'not a URL',
    'http://graph.example.com',
    'https://user:password@graph.example.com',
    'https://graph.example.com?audience=other',
    'https://graph.example.com/#fragment',
  ])('does not fall back to public or legacy Graph for invalid metadata %j', async resource => {
    resources.AzureCloud = resource;
    expect(await searchAzureADUsers('Alice')).toMatchObject({ success: false, users: [] });
    expect(await resolveAzureADUser(user.id)).toMatchObject({ success: false });
    expect(tokenCount).toBe(0);
    expect(requests).toHaveLength(0);
    expect(calls('cloud show')).toHaveLength(2);
  });

  test.each(['azure-auth-update', 'azure-account-change'])(
    'discards local credentials on %s',
    async event => {
      await searchAzureADUsers('Alice');
      window.dispatchEvent(new CustomEvent(event));
      await resolveAzureADUser(user.id);
      expect(tokenCount).toBe(2);
      expect(requests[0].authorization).not.toBe(requests[1].authorization);
    }
  );

  test.each(['search', 'resolve'])(
    'late account read from A cannot replace B after a newer lookup completes (%s)',
    async operation => {
      const dispatch = mocks.command.getMockImplementation()!;
      const accountA = output(account);
      let release!: (value: ReturnType<typeof output>) => void;
      let started!: () => void;
      const waiting = new Promise<void>(resolve => {
        started = resolve;
      });
      mocks.command.mockImplementationOnce(() => {
        started();
        return new Promise(resolve => {
          release = resolve;
        });
      });
      const pendingA =
        operation === 'search' ? searchAzureADUsers('Alice') : resolveAzureADUser(user.id);
      await waiting;
      account = {
        id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        tenantId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        cloudName: 'AzureUSGovernment',
        user: { name: 'operator-b@contoso.com' },
      };
      mocks.command.mockImplementation(dispatch);
      expect((await resolveAzureADUser(user.id)).success).toBe(true);
      expect(tokenCount).toBe(1);
      release(accountA);
      expect((await pendingA).success).toBe(true);
      expect((await searchAzureADUsers('Alice')).success).toBe(true);
      expect(tokenCount).toBe(1);
      expect(calls('cloud show')).toHaveLength(1);
      expect(requests).toHaveLength(3);
      expect(new Set(requests.map(request => request.authorization)).size).toBe(1);
      expect(
        requests.every(request => new URL(request.url).origin === 'https://graph.microsoft.us')
      ).toBe(true);
    }
  );

  test('late cloud metadata from A cannot replace the cached B credential', async () => {
    const dispatch = mocks.command.getMockImplementation()!;
    let release!: (value: ReturnType<typeof output>) => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => {
      started = resolve;
    });
    mocks.command.mockImplementation((command: string, args: string[]) => {
      if (args[0] === 'cloud' && args[1] === 'show' && account.user.name.startsWith('operator-a')) {
        started();
        return new Promise(resolve => {
          release = resolve;
        });
      }
      return dispatch(command, args);
    });
    const pendingA = searchAzureADUsers('Alice');
    await waiting;
    account.user.name = 'operator-b@contoso.com';
    expect((await resolveAzureADUser(user.id)).success).toBe(true);
    release(output({ endpoints: { microsoftGraphResourceId: resources.AzureCloud } }));
    expect(await pendingA).toMatchObject({
      success: false,
      error: expect.stringContaining('account changed'),
    });
    expect((await searchAzureADUsers('Alice')).success).toBe(true);
    expect(tokenCount).toBe(1);
    expect(requests).toHaveLength(2);
  });

  test('late token acquisition from A stays isolated from B, including a switch back to A', async () => {
    const dispatch = mocks.command.getMockImplementation()!;
    let release!: (value: ReturnType<typeof output>) => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => {
      started = resolve;
    });
    mocks.command.mockImplementation((command: string, args: string[]) => {
      if (args[1] === 'get-access-token' && account.user.name.startsWith('operator-a')) {
        started();
        return new Promise(resolve => {
          release = resolve;
        });
      }
      return dispatch(command, args);
    });
    const pendingA = searchAzureADUsers('Alice');
    await waiting;
    account.user.name = 'operator-b@contoso.com';
    await resolveAzureADUser(user.id);
    release(
      output({
        accessToken: 'offline-late-a',
        expires_on: Math.floor(Date.now() / 1000) + 3600,
        tenant: tenantId,
      })
    );
    await pendingA;
    await searchAzureADUsers('Alice');
    expect(requests[0].authorization).toBe(requests[2].authorization);
    expect(requests[1].authorization).not.toBe(requests[2].authorization);
    expect(calls('account get-access-token')).toHaveLength(2);
    account.user.name = 'operator-a@contoso.com';
    mocks.command.mockImplementation(dispatch);
    await resolveAzureADUser(user.id);
    expect(calls('account get-access-token')).toHaveLength(3);
    expect(requests[3].authorization).not.toBe(requests[1].authorization);
  });
});
