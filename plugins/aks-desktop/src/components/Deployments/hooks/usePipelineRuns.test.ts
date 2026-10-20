// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createSessionOctokit } from '../../../utils/github/github-session-client';
import { usePipelineRuns } from './usePipelineRuns';

const auth = vi.hoisted(() => ({
  sessionVersion: 1,
  accessToken: 'account-a-token',
  usable: true,
}));
vi.mock('../../../utils/github/github-session', () => ({
  isGitHubSessionCurrent: (version: number) => auth.sessionVersion === version && auth.usable,
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const repos = [{ owner: 'owner', repo: 'repository', defaultBranch: 'main' }];

it('clears displayed runs immediately when disconnected and ignores delayed previous-session data', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => {
    finish = resolve;
  });
  const body = (id: number) =>
    new Response(
      JSON.stringify({
        workflow_runs: [
          {
            id,
            name: 'Deploy',
            status: 'in_progress',
            conclusion: null,
            html_url: `https://github.com/owner/repository/actions/runs/${id}`,
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  const fetcher = vi.fn().mockResolvedValueOnce(body(1)).mockReturnValueOnce(pending);
  vi.stubGlobal('fetch', fetcher);
  const first = createSessionOctokit(1, () => auth);
  const view = renderHook(({ client, version }) => usePipelineRuns(client, repos, version), {
    initialProps: { client: first as Octokit | null, version: 1 },
  });
  await waitFor(() => expect(view.result.current.runs.map(run => run.id)).toEqual([1]));
  Object.assign(auth, { sessionVersion: 2, accessToken: 'account-b-token' });
  view.rerender({ client: createSessionOctokit(2, () => auth), version: 2 });
  expect(view.result.current.runs).toEqual([]);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  auth.usable = false;
  auth.sessionVersion = 3;
  view.rerender({ client: null, version: 3 });
  await act(async () => {
    finish(body(2));
  });
  expect(view.result.current.runs).toEqual([]);
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.error).toBeNull();
});
