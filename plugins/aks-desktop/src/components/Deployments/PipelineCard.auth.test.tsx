// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { GitHubAuthState } from '../../types/github';
import { openExternalUrl } from '../../utils/shared/openExternalUrl';
import PipelineCard from './PipelineCard';

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  abort: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('../GitHubPipeline/GitHubAuthContext', () => ({ useGitHubAuthContext: mocks.context }));
vi.mock('../../hooks/usePreviewFeatures', () => ({
  usePreviewFeatures: () => ({ githubPipelines: true }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@iconify/react', () => ({ Icon: () => null }));
vi.mock('../DeployTab/hooks/usePipelineStatus', () => ({
  usePipelineStatus: () => ({ isConfigured: true, repos: [] }),
}));
vi.mock('./hooks/usePipelineRuns', () => ({
  usePipelineRuns: () => ({ runs: [], loading: false, error: null }),
}));
vi.mock('../../utils/shared/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
afterEach(cleanup);

it('makes the existing card login entrypoint visible and cancellable instead of waiting for an invisible browser flow', () => {
  const authState: GitHubAuthState = {
    isAuthenticated: false,
    isRestoring: false,
    isAuthorizingBrowser: true,
    token: null,
    refreshToken: null,
    expiresAt: null,
    username: null,
    error: null,
    isDisconnecting: false,
    disconnectError: null,
    sessionVersion: 1,
    deviceAuthorization: {
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: Date.now() + 900000,
    },
  };
  mocks.context.mockReturnValue({
    authState,
    octokit: null,
    startOAuth: mocks.start,
    cancelOAuth: mocks.cancel,
    abortOAuth: mocks.abort,
    reset: mocks.reset,
  });
  const view = render(
    <PipelineCard project={{ id: 'project', clusters: ['cluster'], namespaces: ['namespace'] }} />
  );
  expect(screen.getByRole('status')).toHaveTextContent('ABCD-EFGH');
  expect(openExternalUrl).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open GitHub' }));
  expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/login/device');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mocks.abort).toHaveBeenCalledTimes(1);
  expect(mocks.cancel).not.toHaveBeenCalled();
  view.unmount();
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
});
