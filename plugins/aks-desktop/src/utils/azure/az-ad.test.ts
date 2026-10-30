// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ command: vi.fn(), fetch: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));
vi.mock('./az-cli-path', () => ({ getAzCommand: () => 'az' }));

import { isAzureADLookupUnavailable, resolveAzureADUser, searchAzureADUsers } from './az-ad';
import { azCliCredential } from './az-token';

const user = {
  id: '11111111-2222-3333-4444-555555555555',
  displayName: 'Alice Smith',
  mail: null,
  userPrincipalName: 'alice@contoso.com',
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function requestUrl() {
  return new URL(String(mocks.fetch.mock.calls.at(-1)![0]));
}

beforeEach(() => {
  azCliCredential.clearCache();
  mocks.command.mockReset().mockImplementation(async (_command: string, args: string[]) => {
    if (args[0] !== 'account' || args[1] !== 'get-access-token') {
      throw new Error('Resource-specific CLI commands are forbidden');
    }
    return {
      stdout: JSON.stringify({
        accessToken: 'offline-graph-token',
        expires_on: Math.floor(Date.now() / 1000) + 3600,
      }),
      stderr: '',
    };
  });
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  for (const [command, args] of mocks.command.mock.calls) {
    expect(command).toBe('az');
    expect(args).toEqual([
      'account',
      'get-access-token',
      '--scope',
      'https://graph.microsoft.com/.default',
      '-o',
      'json',
    ]);
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('searchAzureADUsers', () => {
  test('uses the Graph audience and three prefix filters with bounded selected fields', async () => {
    mocks.fetch.mockResolvedValue(json({ value: [user] }));

    expect(await searchAzureADUsers('  Alice Smith  ')).toEqual({
      success: true,
      users: [user],
    });
    const url = requestUrl();
    expect(url.origin + url.pathname).toBe('https://graph.microsoft.com/v1.0/users');
    expect(url.searchParams.get('$filter')).toBe(
      "startswith(displayName,'Alice Smith') or startswith(mail,'Alice Smith') or startswith(userPrincipalName,'Alice Smith')"
    );
    expect(url.searchParams.get('$select')).toBe('id,displayName,mail,userPrincipalName');
    expect(url.searchParams.get('$top')).toBe('15');
    expect([...url.searchParams.keys()].sort()).toEqual(['$filter', '$select', '$top']);
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer offline-graph-token' },
    });
    expect(mocks.command).toHaveBeenCalledTimes(1);
  });

  test.each(['', ' ', 'a', ' a ', "O'Brien", 'test()', 'Ålice', 'a&b'])(
    'preserves empty/short/unsupported search behavior for %j without HTTP or auth',
    async query => {
      expect(await searchAzureADUsers(query)).toEqual({ success: true, users: [] });
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.command).not.toHaveBeenCalled();
    }
  );

  test('caps oversized results and does not enumerate subsequent pages', async () => {
    const users = Array.from({ length: 20 }, (_, i) => ({ ...user, displayName: `Alice ${i}` }));
    mocks.fetch.mockResolvedValue(
      json({ value: users, '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skip=20' })
    );
    expect(await searchAzureADUsers('Alice')).toEqual({ success: true, users: users.slice(0, 15) });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('accepts a genuinely empty result', async () => {
    mocks.fetch.mockResolvedValue(json({ value: [] }));
    expect(await searchAzureADUsers('absent')).toEqual({ success: true, users: [] });
  });

  test.each([
    null,
    [],
    {},
    { value: null },
    { value: {} },
    { value: [user, { id: user.id }] },
    { value: [{ ...user, id: 'not-an-object-id' }] },
    { value: [{ ...user, userPrincipalName: null }] },
    { value: [{ ...user, mail: 42 }] },
  ])('fails rather than returning partial/empty success for malformed payload %j', async body => {
    mocks.fetch.mockResolvedValue(json(body));
    expect(await searchAzureADUsers('Alice')).toMatchObject({
      success: false,
      users: [],
      error: expect.stringContaining('Malformed'),
    });
  });

  test('returns JSON parse failures', async () => {
    mocks.fetch.mockResolvedValue(new Response('{bad json'));
    expect(await searchAzureADUsers('Alice')).toMatchObject({
      success: false,
      users: [],
      error: expect.stringContaining('Malformed JSON'),
    });
  });

  test('surfaces exhausted network failures, never empty success', async () => {
    mocks.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    vi.useFakeTimers();
    const pending = searchAzureADUsers('Alice');
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({
      success: false,
      users: [],
      error: expect.stringContaining('before a response'),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
  });

  test('uses shared GET throttling retries', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json({ error: { code: 'TooManyRequests' } }, 429, { 'retry-after': '0' })
      )
      .mockResolvedValueOnce(json({ value: [user] }));
    expect(await searchAzureADUsers('Alice')).toMatchObject({ success: true, users: [user] });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.command).toHaveBeenCalledTimes(1);
  });

  test('returns persistent throttling as failure after the shared retry budget', async () => {
    mocks.fetch.mockImplementation(() =>
      Promise.resolve(
        json({ error: { code: 'TooManyRequests', message: 'Throttled' } }, 429, {
          'retry-after': '0',
        })
      )
    );
    const result = await searchAzureADUsers('Alice');
    expect(result).toMatchObject({
      success: false,
      users: [],
      error: expect.stringContaining('TooManyRequests'),
    });
    expect(isAzureADLookupUnavailable(result.error)).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
  });
});

describe('resolveAzureADUser', () => {
  test.each([
    [user.id, `/v1.0/users/${user.id}`],
    [' alice@contoso.com ', '/v1.0/users/alice%40contoso.com'],
    [
      'alice_contoso.com#EXT#@tenant.onmicrosoft.com',
      '/v1.0/users/alice_contoso.com%23EXT%23%40tenant.onmicrosoft.com',
    ],
    ["O'Brien@contoso.com", '/v1.0/users/O%27Brien%40contoso.com'],
    ['élise@contoso.com', '/v1.0/users/%C3%A9lise%40contoso.com'],
    ["$O'Brien@contoso.com", "/v1.0/users('%24O%27%27Brien%40contoso.com')"],
  ])('encodes identifier %s without substituting mail, UPN or object ID', async (input, path) => {
    mocks.fetch.mockResolvedValue(json(user));
    expect(await resolveAzureADUser(input)).toEqual({ success: true, user });
    expect(requestUrl().pathname).toBe(path);
    expect(requestUrl().searchParams.get('$select')).toBe('id,displayName,mail,userPrincipalName');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test.each([null, 'guest@example.com'])(
    'retains a returned guest UPN and object ID without substituting mail (%s)',
    async mail => {
      const guest = {
        ...user,
        mail,
        userPrincipalName: 'guest_example.com#EXT#@tenant.onmicrosoft.com',
      };
      mocks.fetch
        .mockResolvedValueOnce(json({ value: [guest] }))
        .mockResolvedValueOnce(json(guest));
      expect(await searchAzureADUsers('guest')).toEqual({ success: true, users: [guest] });
      expect(await resolveAzureADUser(guest.userPrincipalName)).toEqual({
        success: true,
        user: guest,
      });
      expect(requestUrl().pathname).toContain('%23EXT%23');
      expect(mocks.command).toHaveBeenCalledTimes(1);
    }
  );

  test.each(['', 'not-an-id', 'alice@contoso', 'a b@contoso.com'])(
    'rejects invalid identifier %j before auth',
    async input => {
      expect(await resolveAzureADUser(input)).toEqual({
        success: false,
        error: 'Not a valid object ID or user principal name',
      });
      expect(mocks.command).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );

  test.each([null, {}, { ...user, mail: undefined }, { ...user, displayName: 42 }])(
    'rejects malformed or partial user %j',
    async body => {
      mocks.fetch.mockResolvedValue(json(body));
      expect(await resolveAzureADUser(user.id)).toMatchObject({
        success: false,
        error: expect.stringContaining('Malformed'),
      });
    }
  );
});

describe('lookup errors', () => {
  test.each([
    [403, 'Authorization_RequestDenied'],
    [403, 'ErrorAccessDenied'],
    [403, 'accessDenied'],
    [403, 'insufficient_claims'],
    [401, 'InvalidAuthenticationToken'],
    [404, 'Request_ResourceNotFound'],
    [400, 'Request_BadRequest'],
  ])('preserves Graph %i error code and correlation diagnostics', async (status, code) => {
    mocks.fetch.mockImplementation(() =>
      Promise.resolve(
        json({ error: { code, message: 'Graph diagnostic' } }, status, { 'request-id': 'req-18' })
      )
    );
    for (const lookup of [() => searchAzureADUsers('Alice'), () => resolveAzureADUser(user.id)]) {
      const result = await lookup();
      expect(result.success).toBe(false);
      expect(result.error).toContain(code);
      expect(result.error).toContain(`HTTP ${status}`);
      expect(result.error).toContain('req-18');
      expect(isAzureADLookupUnavailable(result.error)).toBe(status === 403);
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test.each(['AADSTS530084', 'AADSTS50076', 'AADSTS50079', 'AADSTS65001', 'AADSTS65004'])(
    'keeps CLI-backed Graph token acquisition failures recognizable: %s',
    async code => {
      mocks.command.mockResolvedValue({ stdout: '', stderr: `${code}: blocked` });
      for (const lookup of [() => searchAzureADUsers('Alice'), () => resolveAzureADUser(user.id)]) {
        const result = await lookup();
        expect(result.success).toBe(false);
        expect(result.error).toContain(code);
        expect(isAzureADLookupUnavailable(result.error)).toBe(true);
      }
      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );

  test.each([
    'Authorization_RequestDenied',
    'ErrorAccessDenied',
    'accessDenied',
    'Insufficient privileges to complete the operation.',
    'consent_required',
    'insufficient_claims',
  ])('recognizes directory access unavailable diagnostic %s', message => {
    expect(isAzureADLookupUnavailable(message)).toBe(true);
  });

  test.each([
    undefined,
    'Request_BadRequest (HTTP 400)',
    'Request_ResourceNotFound (HTTP 404)',
    'Azure request failed before a response was received',
    'TooManyRequests (HTTP 429)',
  ])('does not mask unrelated failure %s as a permission problem', message => {
    expect(isAzureADLookupUnavailable(message)).toBe(false);
  });
});
