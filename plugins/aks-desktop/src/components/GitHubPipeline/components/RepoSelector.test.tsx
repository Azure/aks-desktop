// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { createSessionOctokit } from '../../../utils/github/github-session-client';
import { RepoSelector } from './RepoSelector';

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
vi.mock('@iconify/react', () => ({ Icon: () => null }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('ignores delayed account-A repository pages and blocks subsequent stale-client pages', async () => {
  let finishA!: (response: Response) => void;
  const a = new Promise<Response>(resolve => {
    finishA = resolve;
  });
  const repo = (owner: string) => ({
    name: 'repository',
    full_name: `${owner}/repository`,
    owner: { login: owner },
    default_branch: 'main',
    private: true,
  });
  const fetcher = vi
    .fn()
    .mockReturnValueOnce(a)
    .mockResolvedValueOnce(
      new Response(JSON.stringify([repo('account-b')]), {
        headers: { 'content-type': 'application/json' },
      })
    );
  vi.stubGlobal('fetch', fetcher);
  const choose = vi.fn();
  const view = render(
    <RepoSelector
      octokit={createSessionOctokit(1, () => auth)}
      sessionVersion={1}
      selectedRepo={null}
      onRepoSelect={choose}
    />
  );
  await act(async () => {
    await Promise.resolve();
  });
  Object.assign(auth, { sessionVersion: 2, accessToken: 'account-b-token' });
  view.rerender(
    <RepoSelector
      octokit={createSessionOctokit(2, () => auth)}
      sessionVersion={2}
      selectedRepo={null}
      onRepoSelect={choose}
    />
  );
  await screen.findByText('account-b/repository');
  await act(async () => {
    finishA(
      new Response(JSON.stringify([repo('account-a')]), {
        headers: {
          'content-type': 'application/json',
          link: '<https://api.github.com/user/repos?page=2>; rel="next"',
        },
      })
    );
  });
  expect(screen.queryByText('account-a/repository')).not.toBeInTheDocument();
  expect(screen.getByText('account-b/repository')).toBeInTheDocument();
  expect(choose).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
