// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), logout: vi.fn() }));
vi.mock('@iconify/react', () => ({ Icon: () => null }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));
vi.mock('../shared/CopyButton', () => ({ CopyButton: () => null }));
vi.mock('./hooks/useAzureProfilePage', () => ({ useAzureProfilePage: mocks.profile }));

import AzureProfilePage from './AzureProfilePage';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mockReturnValue({
    isChecking: false,
    isLoggedIn: false,
    loggingOut: false,
    logoutError: 'Native sign-out completed, but Azure CLI sign-out failed.',
    logoutNotice: '',
    handleLogout: mocks.logout,
    handleBack: vi.fn(),
    handleAddCluster: vi.fn(),
  });
});

afterEach(cleanup);

test('shows a partial sign-out failure and retry after native sign-out', () => {
  render(<AzureProfilePage />);
  expect(screen.getByRole('alert').textContent).toContain('Azure CLI sign-out failed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry sign-out' }));
  expect(mocks.logout).toHaveBeenCalledOnce();
});

test('shows native-only sign-out when CLI is unavailable', () => {
  mocks.profile.mockReturnValue({
    isChecking: false,
    isLoggedIn: false,
    loggingOut: true,
    logoutError: '',
    logoutNotice: 'Azure CLI was not available. Native Azure sign-out completed.',
  });
  render(<AzureProfilePage />);
  expect(screen.getByRole('status').textContent).toContain('CLI was not available');
  expect(screen.queryByText('Logging out...')).toBeNull();
});

test.each([false, true])(
  'keeps sign-out progress visible while CLI logout is pending (checking=%s)',
  isChecking => {
    mocks.profile.mockReturnValue({
      isChecking,
      isLoggedIn: false,
      loggingOut: true,
      logoutError: '',
      logoutNotice: '',
    });
    render(<AzureProfilePage />);
    expect(screen.getByRole('status').textContent).toContain('Logging out');
    expect(screen.queryByRole('button', { name: 'Retry sign-out' })).toBeNull();
  }
);

test('allows leaving the signed-out card while CLI logout remains queued', () => {
  const handleBack = vi.fn();
  mocks.profile.mockReturnValue({
    isChecking: false,
    isLoggedIn: false,
    loggingOut: true,
    logoutError: '',
    logoutNotice: '',
    handleBack,
  });
  render(<AzureProfilePage />);
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(handleBack).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toContain('Logging out');
});
