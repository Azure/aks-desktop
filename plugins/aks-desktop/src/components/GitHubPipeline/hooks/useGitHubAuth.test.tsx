// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  initiate: vi.fn(),
  poll: vi.fn(),
  refresh: vi.fn(),
  preview: { enabled: false },
}));
vi.mock('../../../utils/github/github-auth', async original => ({
  ...(await original<typeof import('../../../utils/github/github-auth')>()),
  loadTokens: mocks.load,
  saveTokens: mocks.save,
  clearTokens: mocks.clear,
}));
vi.mock('../../../utils/github/github-device-flow', () => ({
  initiateDeviceFlow: mocks.initiate,
  waitForDeviceTokens: mocks.poll,
  refreshDeviceToken: mocks.refresh,
}));
vi.mock('../../../hooks/usePreviewFeatures', () => ({
  usePreviewFeatures: () => ({ githubPipelines: mocks.preview.enabled }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ getHeadlampAPIHeaders: vi.fn() }));
let useGitHubAuth: typeof import('./useGitHubAuth').useGitHubAuth;

beforeEach(async () => {
  vi.resetModules();
  vi.doMock('react', () => React);
  vi.clearAllMocks();
  mocks.preview.enabled = false;
  mocks.load.mockResolvedValue(null);
  mocks.save.mockResolvedValue(true);
  mocks.clear.mockResolvedValue({ success: true });
  mocks.initiate.mockResolvedValue({
    deviceCode: 'private-device-code',
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://github.com/login/device',
    expiresAt: Date.now() + 900000,
    intervalMs: 5000,
  });
  mocks.poll.mockResolvedValue({
    accessToken: 'account-a-token',
    refreshToken: 'refresh-a',
    expiresIn: 3600,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('{"login":"account-a"}', { headers: { 'content-type': 'application/json' } })
    )
  );
  useGitHubAuth = (await import('./useGitHubAuth')).useGitHubAuth;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('react');
});

describe('React subscriptions to one GitHub session', () => {
  it('shares login/disconnect immediately across independently mounted trees', async () => {
    const a = renderHook(() => useGitHubAuth());
    const b = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(a.result.current.authState.isRestoring).toBe(false));
    expect(mocks.load).toHaveBeenCalledTimes(1);
    await act(async () => {
      await a.result.current.startOAuth();
    });
    expect(a.result.current.authState).toBe(b.result.current.authState);
    expect(a.result.current.octokit).toBe(b.result.current.octokit);
    expect(a.result.current.authState.username).toBe('account-a');
    await act(async () => {
      expect(await b.result.current.reset()).toEqual({ success: true });
    });
    expect(a.result.current.authState.isAuthenticated).toBe(false);
    expect(b.result.current.octokit).toBeNull();
    a.unmount();
    b.unmount();
  });

  it('does not duplicate bootstrap through StrictMode effect replay', async () => {
    const view = renderHook(() => useGitHubAuth(), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });
    await waitFor(() => expect(view.result.current.authState.isRestoring).toBe(false));
    expect(mocks.load).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it('does not initialize when preview is off, and cancels hidden login without deleting credentials', async () => {
    let complete!: (value: unknown) => void;
    mocks.poll.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = resolve;
        })
    );
    const { GitHubAuthProvider, useGitHubAuthContext } = await import('../GitHubAuthContext');
    function Child() {
      const auth = useGitHubAuthContext();
      return (
        <button onClick={() => void auth.startOAuth()}>
          {auth.authState.isAuthorizingBrowser ? 'Waiting' : 'Ready'}
        </button>
      );
    }
    const tree = () => (
      <GitHubAuthProvider>
        <Child />
      </GitHubAuthProvider>
    );
    const view = render(tree());
    expect(mocks.load).not.toHaveBeenCalled();
    mocks.preview.enabled = true;
    view.rerender(tree());
    fireEvent.click(await view.findByRole('button', { name: 'Ready' }));
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledTimes(1));
    mocks.preview.enabled = false;
    view.rerender(tree());
    expect(mocks.poll.mock.calls[0][1].aborted).toBe(true);
    expect(mocks.clear).not.toHaveBeenCalled();
    await act(async () => {
      complete({ accessToken: 'late-a', refreshToken: 'late-r', expiresIn: 3600 });
    });
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.preview.enabled = true;
    view.rerender(tree());
    await view.findByRole('button', { name: 'Ready' });
    expect(mocks.load).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
