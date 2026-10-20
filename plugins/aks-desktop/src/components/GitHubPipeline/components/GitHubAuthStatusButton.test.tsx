// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitHubAuthFixture } from '../__fixtures__/github-auth';
import type { UseGitHubAuthResult } from '../hooks/useGitHubAuth';
import { GitHubAuthStatusButton } from './GitHubAuthStatusButton';

afterEach(cleanup);

const context = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../GitHubAuthContext', () => ({ useGitHubAuthContext: context.read }));
vi.mock('../../../hooks/usePreviewFeatures', () => ({
  usePreviewFeatures: () => ({ githubPipelines: true }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@iconify/react', () => ({ Icon: () => null }));
let auth: UseGitHubAuthResult;
beforeEach(() => {
  auth = createGitHubAuthFixture();
  context.read.mockImplementation(() => auth);
});

describe('project GitHub account control', () => {
  it('opens a keyboard-accessible account dialog with explicit local disconnect', async () => {
    auth.authState = { ...auth.authState, isAuthenticated: true, username: 'account-a' };
    render(<GitHubAuthStatusButton />);
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'GitHub account' }).focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    await user.keyboard('{Tab}');
    expect(within(dialog).getByRole('button', { name: 'Disconnect GitHub' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(auth.reset).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveTextContent('Repositories and deployments are kept.');
  });

  it('shows shared device approval without opening a browser automatically, and cancels on dismiss', async () => {
    const view = render(<GitHubAuthStatusButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(auth.startOAuth).toHaveBeenCalledTimes(1);
    auth.authState = {
      ...auth.authState,
      isAuthorizingBrowser: true,
      deviceAuthorization: {
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://github.com/login/device',
        expiresAt: Date.now() + 900000,
      },
    };
    view.rerender(<GitHubAuthStatusButton />);
    expect(screen.getByRole('status')).toHaveTextContent('ABCD-EFGH');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(auth.cancelOAuth).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(auth.abortOAuth).toHaveBeenCalledTimes(1);
    expect(auth.cancelOAuth).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('disables duplicate cleanup and keeps failure/retry visible instead of offering a new login', async () => {
    auth.authState = { ...auth.authState, isAuthenticated: true, username: 'account-a' };
    const view = render(<GitHubAuthStatusButton />);
    fireEvent.click(screen.getByRole('button', { name: 'GitHub account' }));
    auth.authState = {
      ...auth.authState,
      isAuthenticated: false,
      isDisconnecting: true,
      username: null,
    };
    view.rerender(<GitHubAuthStatusButton />);
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Disconnect GitHub' })
    ).toBeDisabled();
    auth.authState = {
      ...auth.authState,
      isDisconnecting: false,
      disconnectError: 'cleanup failed',
    };
    view.rerender(<GitHubAuthStatusButton />);
    expect(screen.getByRole('alert')).toHaveTextContent('Saved GitHub credentials may remain.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry disconnect' }));
    expect(auth.reset).toHaveBeenCalledTimes(1);
    expect(auth.startOAuth).not.toHaveBeenCalled();
    auth.authState = { ...auth.authState, disconnectError: null };
    view.rerender(<GitHubAuthStatusButton />);
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Connect GitHub' })
    ).toBeEnabled();
  });
});
