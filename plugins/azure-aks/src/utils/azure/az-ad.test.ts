// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const getToken = vi.hoisted(() => vi.fn());

vi.mock('../../azureAuth', () => ({ azureCredential: { getToken } }));

import { searchAzureADUsers } from './az-ad';

describe('searchAzureADUsers', () => {
  beforeEach(() => {
    getToken.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  test('uses the preauthorized Microsoft Graph default scope', async () => {
    getToken.mockResolvedValue({ token: 'graph-token' });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          value: [
            {
              id: 'user-id',
              displayName: 'Ada Lovelace',
              mail: 'ada@example.com',
              userPrincipalName: 'ada@example.com',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await searchAzureADUsers('Ada');

    expect(getToken).toHaveBeenCalledWith('https://graph.microsoft.com/.default');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://graph.microsoft.com/v1.0/users'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer graph-token' }),
      })
    );
    expect(result).toEqual({
      success: true,
      users: [
        {
          id: 'user-id',
          displayName: 'Ada Lovelace',
          mail: 'ada@example.com',
          userPrincipalName: 'ada@example.com',
        },
      ],
    });
  });
});
