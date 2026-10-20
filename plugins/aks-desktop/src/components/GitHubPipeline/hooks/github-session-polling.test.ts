// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, renderHook } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('../../../utils/github/github-auth', async original => ({
  ...(await original<typeof import('../../../utils/github/github-auth')>()),
  loadTokens: storage.load,
  saveTokens: storage.save,
  clearTokens: storage.clear,
}));
vi.mock('../../../utils/github/github-device-flow', () => ({
  refreshDeviceToken: storage.refresh,
  initiateDeviceFlow: vi.fn(),
  waitForDeviceTokens: vi.fn(),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ getHeadlampAPIHeaders: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const run = (id: number) => ({
  id,
  name: id === 77 ? 'Copilot agent' : 'Deploy',
  status: 'in_progress',
  conclusion: null,
  html_url: `https://github.com/owner/repository/actions/runs/${id}`,
  created_at: '2026-01-01T00:00:00Z',
});
let session: typeof import('../../../utils/github/github-session');
let workflow: typeof import('./useWorkflowPolling').useWorkflowPolling;
let agent: typeof import('./useAgentWorkflowProgress').useAgentWorkflowProgress;
let access: typeof import('./useGitHubRepoAccess').useGitHubRepoAccess;
let release: () => void;
let calls: { path: string; bearer: string | null }[];
let workflowDiscovery: Promise<Response> | null;
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

beforeEach(async () => {
  vi.resetModules();
  vi.doMock('react', () => React);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  calls = [];
  workflowDiscovery = null;
  storage.load.mockResolvedValue({
    accessToken: 'account-a-token',
    refreshToken: 'refresh-a',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  storage.save.mockResolvedValue(true);
  storage.clear.mockResolvedValue({ success: true });
  storage.refresh.mockResolvedValue({
    accessToken: 'rotated-a-token',
    refreshToken: 'rotated-refresh',
    expiresIn: 3600,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, options) => {
      const url = new URL(String(input));
      calls.push({
        path: url.pathname,
        bearer: new Headers(options?.headers).get('authorization'),
      });
      if (url.pathname === '/user') return json({ login: 'account-a' });
      if (url.pathname === '/repos/owner/repository')
        return json({ full_name: 'owner/repository', default_branch: 'main' });
      if (url.pathname.includes('/workflows/')) {
        if (workflowDiscovery) {
          const pending = workflowDiscovery;
          workflowDiscovery = null;
          return pending;
        }
        return json({
          workflow_runs: [run(url.searchParams.get('branch') === 'release' ? 99 : 42)],
        });
      }
      if (url.pathname.endsWith('/actions/runs')) return json({ workflow_runs: [run(77)] });
      if (url.pathname.endsWith('/jobs'))
        return json({
          jobs: [
            {
              name: 'agent',
              status: 'in_progress',
              steps: [
                {
                  name: 'Processing Request',
                  number: 1,
                  status: 'in_progress',
                  started_at: '2026-01-01T00:00:00Z',
                },
              ],
            },
          ],
        });
      const id = Number(url.pathname.split('/').pop());
      return json(run(id));
    })
  );
  session = await import('../../../utils/github/github-session');
  workflow = (await import('./useWorkflowPolling')).useWorkflowPolling;
  agent = (await import('./useAgentWorkflowProgress')).useAgentWorkflowProgress;
  access = (await import('./useGitHubRepoAccess')).useGitHubRepoAccess;
  release = session.retainGitHubSession(Symbol());
  await settle();
});
afterEach(() => {
  cleanup();
  release();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('react');
});

describe('real coordinator/client workflow identity', () => {
  it('starts fresh run discovery for an explicit retry on the same branch', async () => {
    const { octokit: client, authState } = session.getGitHubSessionSnapshot();
    const view = renderHook(
      ({ attempt }) =>
        workflow(client, 'owner', 'repository', 'main', true, authState.sessionVersion, attempt),
      { initialProps: { attempt: 'first' } }
    );
    await settle();
    expect(view.result.current.runUrl).toContain('/42');
    workflowDiscovery = Promise.resolve(json({ workflow_runs: [run(99)] }));
    view.rerender({ attempt: 'retry' });
    expect(view.result.current.runUrl).toBeNull();
    await settle();
    expect(view.result.current.runUrl).toContain('/99');
    expect(calls.filter(call => call.path.includes('/workflows/'))).toHaveLength(2);
  });

  it('keeps acquired workflow/agent IDs and repository readiness through rotation and a polling pause', async () => {
    const before = session.getGitHubSessionSnapshot();
    const client = before.octokit!;
    const version = before.authState.sessionVersion;
    const repo = { owner: 'owner', repo: 'repository', defaultBranch: 'main' };
    const view = renderHook(
      ({ enabled }) => ({
        workflow: workflow(client, repo.owner, repo.repo, 'main', enabled, version),
        agent: agent(client, repo.owner, repo.repo, enabled, 9, version),
        access: access(client, repo, version),
      }),
      { initialProps: { enabled: true } }
    );
    await settle();
    expect(view.result.current.workflow.runUrl).toContain('/42');
    expect(view.result.current.agent.runFound).toBe(true);
    expect(view.result.current.access.status).toBe('granted');
    view.rerender({ enabled: false });
    await act(() => vi.advanceTimersByTimeAsync(55 * 60000));
    expect(session.getGitHubSessionSnapshot().octokit).toBe(client);
    expect(session.getGitHubSessionSnapshot().authState.sessionVersion).toBe(version);
    view.rerender({ enabled: true });
    await settle();
    expect(view.result.current.workflow.runUrl).toContain('/42');
    expect(view.result.current.agent.agentStartedAt).toBe('2026-01-01T00:00:00Z');
    expect(view.result.current.access.status).toBe('granted');
    expect(calls.filter(call => call.path.includes('/workflows/'))).toHaveLength(1);
    expect(calls.filter(call => call.path.endsWith('/actions/runs'))).toHaveLength(1);
    expect(calls.filter(call => call.path === '/repos/owner/repository')).toHaveLength(1);
    expect(calls.filter(call => call.path.endsWith('/42')).slice(-1)[0]?.bearer).toBe(
      'Bearer rotated-a-token'
    );
    expect(calls.filter(call => call.path.endsWith('/77/jobs')).slice(-1)[0]?.bearer).toBe(
      'Bearer rotated-a-token'
    );
  });

  it('never lets delayed run discovery overwrite a new branch identity', async () => {
    const pending = deferred<Response>();
    workflowDiscovery = pending.promise;
    const { octokit: client, authState } = session.getGitHubSessionSnapshot();
    const view = renderHook(
      ({ branch }) =>
        workflow(client, 'owner', 'repository', branch, true, authState.sessionVersion),
      { initialProps: { branch: 'main' } }
    );
    await settle();
    view.rerender({ branch: 'release' });
    await settle();
    expect(view.result.current.runUrl).toContain('/99');
    pending.resolve(json({ workflow_runs: [run(42)] }));
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(view.result.current.runUrl).toContain('/99');
    expect(calls.some(call => call.path.endsWith('/actions/runs/42'))).toBe(false);
  });
});
