// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionOctokit } from '../../../utils/github/github-session-client';
import { createValidConfig } from '../__fixtures__/pipelineConfig';
import { createSetupPR } from './pipelineOrchestration';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('real multi-request setup helper with session-bound Octokit', () => {
  it.each(['sha', 'branch'])(
    'does not send follow-on writes or cleanup after invalidation at %s',
    async boundary => {
      let finish!: (response: Response) => void;
      const held = new Promise<Response>(resolve => {
        finish = resolve;
      });
      const methods: string[] = [];
      let start!: () => void;
      const started = new Promise<void>(resolve => {
        start = resolve;
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url, options) => {
          const method = options?.method ?? 'GET';
          methods.push(method);
          if (
            (boundary === 'sha' && method === 'GET') ||
            (boundary === 'branch' && method === 'POST')
          ) {
            start();
            return held;
          }
          return json({ object: { sha: 'fixture-sha' } });
        })
      );
      const auth = { sessionVersion: 1, accessToken: 'synthetic-private-a', usable: true };
      const client = createSessionOctokit(1, () => auth);
      const operation = createSetupPR(client, createValidConfig());
      await started;
      auth.sessionVersion = 2;
      auth.accessToken = 'synthetic-private-b';
      finish(
        json(
          boundary === 'sha' ? { object: { sha: 'fixture-sha' } } : {},
          boundary === 'sha' ? 200 : 201
        )
      );
      await expect(operation).rejects.toThrow();
      expect(methods).toEqual(boundary === 'sha' ? ['GET'] : ['GET', 'POST']);
    }
  );

  it('does not leak the bearer through real SDK cleanup errors while a session is still current', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, options) => {
        const method = options?.method ?? 'GET';
        if (String(input).includes('/git/ref/')) return json({ object: { sha: 'fixture-sha' } });
        if (method === 'POST') return json({}, 201);
        return json({ message: 'fixture-request-failed' }, method === 'DELETE' ? 403 : 500);
      })
    );
    const client = createSessionOctokit(1, () => ({
      sessionVersion: 1,
      accessToken: 'synthetic-private-a',
      usable: true,
    }));
    await expect(createSetupPR(client, createValidConfig())).rejects.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(inspect(warn.mock.calls, { showHidden: true, depth: 12 })).not.toContain(
      'synthetic-private-a'
    );
  });
});
