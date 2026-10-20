// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGitHubAuthFixture } from '../__fixtures__/github-auth';
import { ConnectSourceStep } from './ConnectSourceStep';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@iconify/react', () => ({ Icon: () => null }));
vi.mock('./RepoSelector', () => ({ RepoSelector: () => <div>Repository selector</div> }));
afterEach(cleanup);

function props(auth = createGitHubAuthFixture()) {
  return {
    authState: auth.authState,
    onStartOAuth: auth.startOAuth,
    onCancelOAuth: auth.cancelOAuth,
    onAbortOAuth: auth.abortOAuth,
    onDisconnect: auth.reset,
    octokit: auth.octokit,
    selectedRepo: null,
    onRepoSelect: vi.fn(),
  };
}

describe('wizard GitHub connection', () => {
  it('uses current authorization, not a remembered username, to display connected state', () => {
    const auth = createGitHubAuthFixture({ username: 'old-account' });
    render(<ConnectSourceStep {...props(auth)} />);
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
    expect(screen.queryByText('Repository selector')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect GitHub' })).not.toBeInTheDocument();
  });

  it('renders the shared code and cancels an owned attempt on unmount', () => {
    const auth = createGitHubAuthFixture({
      isAuthorizingBrowser: true,
      deviceAuthorization: {
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://github.com/login/device',
        expiresAt: Date.now() + 900000,
      },
    });
    const view = render(<ConnectSourceStep {...props(auth)} />);
    expect(screen.getByRole('status')).toHaveTextContent('ABCD-EFGH');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(auth.abortOAuth).toHaveBeenCalledTimes(1);
    expect(auth.cancelOAuth).not.toHaveBeenCalled();
    view.unmount();
    expect(auth.cancelOAuth).toHaveBeenCalledTimes(1);
  });

  it('shows retryable cleanup failure instead of a new connect action', () => {
    const auth = createGitHubAuthFixture({ disconnectError: 'cleanup failed' });
    render(<ConnectSourceStep {...props(auth)} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Saved GitHub credentials may remain.');
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry disconnect' }));
    expect(auth.reset).toHaveBeenCalledTimes(1);
  });
});
