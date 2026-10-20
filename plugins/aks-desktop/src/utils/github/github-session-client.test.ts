// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionOctokit, SessionInvalidatedError } from './github-session-client';

afterEach(() => vi.unstubAllGlobals());

describe('session-bound real Octokit', () => {
  it('reads the current bearer at each dispatch and overrides caller-supplied stale auth', async () => {
    const sent: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        sent.push(new Headers(init?.headers).get('authorization'));
        return new Response('{"login":"account-a"}', {
          headers: { 'content-type': 'application/json' },
        });
      })
    );
    const state = { sessionVersion: 1, accessToken: 'token-a', usable: true };
    const client = createSessionOctokit(1, () => state);
    expect((await client.users.getAuthenticated()).data.login).toBe('account-a');
    state.accessToken = 'rotated-token';
    await client.request('GET /user', { headers: { authorization: 'Bearer stale-manual-token' } });
    expect(sent).toEqual(['Bearer token-a', 'Bearer rotated-token']);
    state.usable = false;
    await expect(client.users.getAuthenticated()).rejects.toBeInstanceOf(SessionInvalidatedError);
    state.usable = true;
    state.sessionVersion = 2;
    await expect(client.users.getAuthenticated()).rejects.toBeInstanceOf(SessionInvalidatedError);
    expect(sent).toHaveLength(2);
  });

  it('rejects a follow-on real pagination request across account invalidation', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('[{"id":1}]', {
          headers: {
            'content-type': 'application/json',
            link: '<https://api.github.com/user/repos?page=2>; rel="next"',
          },
        })
    );
    vi.stubGlobal('fetch', fetcher);
    const state = { sessionVersion: 1, accessToken: 'token-a', usable: true };
    const client = createSessionOctokit(1, () => state);
    const pages = client.paginate
      .iterator('GET /user/repos', { per_page: 1 })
      [Symbol.asyncIterator]();
    expect((await pages.next()).value?.data).toEqual([{ id: 1 }]);
    state.sessionVersion = 2;
    await expect(pages.next()).rejects.toBeInstanceOf(SessionInvalidatedError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not expose credentials through logging or invalidation errors', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const client = createSessionOctokit(1, () => ({
        sessionVersion: 2,
        accessToken: 'private-token',
        usable: true,
      }));
      const error = await client.request('GET /user').catch(value => value);
      expect(String(error) + JSON.stringify(error)).not.toContain('private-token');
      expect(logger).not.toHaveBeenCalled();
    } finally {
      logger.mockRestore();
    }
  });
});
