// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const context = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../GitHubAuthContext', () => ({ useGitHubAuthContext: context.read }));
vi.mock('../../../hooks/usePreviewFeatures', () => ({
  usePreviewFeatures: () => ({ githubPipelines: true }),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@iconify/react', () => ({ Icon: () => null }));
import { GitHubAuthStatusButton } from './GitHubAuthStatusButton';
afterEach(cleanup);

it('offers an explicit local disconnect from the connected account control', () => {
  const reset = vi.fn();
  context.read.mockReturnValue({
    authState: { isAuthenticated: true, username: 'account-a' },
    reset,
  });
  render(<GitHubAuthStatusButton />);
  fireEvent.click(screen.getByRole('button', { name: 'account-a' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('this app only');
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect GitHub' }));
  expect(reset).toHaveBeenCalledTimes(1);
});

it('does not expose disconnect while browser sign-in is pending', () => {
  context.read.mockReturnValue({ authState: { isAuthorizingBrowser: true } });
  render(<GitHubAuthStatusButton />);
  expect(
    screen.getByRole('button', { name: 'Waiting for browser authorization...' })
  ).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Disconnect GitHub' })).not.toBeInTheDocument();
});

it('offers retry instead of sign-in when credentials could not be removed', () => {
  const reset = vi.fn();
  context.read.mockReturnValue({
    authState: { isAuthenticated: false, disconnectError: 'failed' },
    reset,
  });
  render(<GitHubAuthStatusButton />);
  fireEvent.click(screen.getByRole('button', { name: 'GitHub disconnect failed' }));
  expect(screen.getByRole('alert')).toHaveTextContent('could not be removed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry disconnect' }));
  expect(reset).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Connect GitHub' })).not.toBeInTheDocument();
});
