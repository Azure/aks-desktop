// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseAzureProfilePage = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@iconify/react', () => ({
  Icon: ({ icon, ...props }: any) => <span data-icon={icon} {...props} />,
}));

vi.mock('./hooks/useAzureProfilePage', () => ({
  useAzureProfilePage: mockUseAzureProfilePage,
}));

import AzureProfilePage from './AzureProfilePage';

async function runAxe() {
  const results = await axe.run(document.body, {
    rules: {
      'color-contrast': { enabled: false },
    },
  });
  return results.violations;
}

describe('AzureProfilePage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAzureProfilePage.mockReturnValue({
      isChecking: false,
      isLoggedIn: true,
      username: 'user@contoso.com',
      tenantId: 'tenant-abc',
      subscriptionId: 'sub-123',
      loggingOut: false,
      handleBack: vi.fn(),
      handleAddCluster: vi.fn(),
      handleBareMetalProxy: vi.fn(),
      handleLogout: vi.fn(),
    });
  });

  it('has no axe violations when showing BareMetal proxy access from the Azure account page', async () => {
    render(<AzureProfilePage />);

    await screen.findByRole('heading', { name: 'Azure Account' });
    await screen.findByRole('button', { name: 'BareMetal Proxy' });

    const violations = await runAxe();
    expect(violations).toEqual([]);
  });

  it('has no axe violations while loading Azure account information', async () => {
    mockUseAzureProfilePage.mockReturnValue({
      isChecking: true,
      isLoggedIn: false,
      username: undefined,
      tenantId: undefined,
      subscriptionId: undefined,
      loggingOut: false,
      handleBack: vi.fn(),
      handleAddCluster: vi.fn(),
      handleBareMetalProxy: vi.fn(),
      handleLogout: vi.fn(),
    });

    render(<AzureProfilePage />);

    await screen.findByText('Loading Azure account information...');

    const violations = await runAxe();
    expect(violations).toEqual([]);
  });
});
