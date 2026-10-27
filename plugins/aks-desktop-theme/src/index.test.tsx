// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  Headlamp,
  registerAppBarAction,
  registerAppLogo,
  registerAppTheme,
  registerClusterEmptyState,
} from '@kinvolk/headlamp-plugin/lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AKSClusterEmptyState from './components/ClusterEmptyState/AKSClusterEmptyState';
import AzureLogo from './components/Logo/Logo';
import { CONTACT_US_URL } from './utils/constants/contactUs';
import { azureTheme } from './utils/shared/theme';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  Headlamp: {
    isRunningAsApp: vi.fn(),
    setAppMenu: vi.fn(),
  },
  registerAppBarAction: vi.fn(),
  registerAppLogo: vi.fn(),
  registerAppTheme: vi.fn(),
  registerClusterEmptyState: vi.fn(),
}));

vi.mock('./components/ContactUs/ContactUsButton', () => ({ default: () => null }));
vi.mock('./components/Logo/Logo', () => ({ default: () => null }));
vi.mock('./components/ClusterEmptyState/AKSClusterEmptyState', () => ({
  default: () => null,
}));

beforeEach(() => {
  vi.resetModules();
  vi.mocked(Headlamp.isRunningAsApp).mockReturnValue(true);
});

describe('theme registration', () => {
  it('registers the existing branding and default theme in the desktop app', async () => {
    await import('./index');

    expect(registerAppLogo).toHaveBeenCalledExactlyOnceWith(AzureLogo);
    expect(registerClusterEmptyState).toHaveBeenCalledExactlyOnceWith(AKSClusterEmptyState);
    expect(registerAppTheme).toHaveBeenCalledExactlyOnceWith(azureTheme, { default: true });
    expect(registerAppBarAction).toHaveBeenCalledExactlyOnceWith({
      id: 'aksd.contact-us',
      action: expect.any(Function),
    });
    expect(Headlamp.setAppMenu).toHaveBeenCalledTimes(1);
  });

  it('does not register desktop branding in the web app', async () => {
    vi.mocked(Headlamp.isRunningAsApp).mockReturnValue(false);
    await import('./index');

    expect(registerAppLogo).not.toHaveBeenCalled();
    expect(registerClusterEmptyState).not.toHaveBeenCalled();
    expect(registerAppTheme).not.toHaveBeenCalled();
    expect(registerAppBarAction).not.toHaveBeenCalled();
    expect(Headlamp.setAppMenu).not.toHaveBeenCalled();
  });
});

describe('AKS Help menu', () => {
  async function menuTransform() {
    await import('./index');
    return vi.mocked(Headlamp.setAppMenu).mock.calls[0][0];
  }

  it('replaces only the documentation and issue links', async () => {
    const transform = await menuTransform();
    const about = { id: 'original-about', label: 'About' };
    const fileMenu = { id: 'original-file', label: 'File' };
    const menus: Parameters<Parameters<typeof Headlamp.setAppMenu>[0]>[0] = [
      fileMenu,
      {
        id: 'original-help',
        submenu: [
          { id: 'original-documentation', url: 'https://headlamp.dev/docs' },
          { id: 'original-open-issue', url: 'https://github.com/kubernetes-sigs/headlamp/issues' },
          about,
        ],
      },
    ];

    expect(transform(menus)).toBe(menus);
    expect(menus[0]).toBe(fileMenu);
    expect(menus[1].submenu).toEqual([
      {
        id: 'aks-documentation',
        label: 'Documentation',
        url: 'https://aka.ms/aks/aks-desktop',
      },
      { id: 'aks-contact-us', label: 'Contact us', url: CONTACT_US_URL },
      about,
    ]);
  });

  it('preserves menus when the Help menu or original links are absent', async () => {
    const transform = await menuTransform();
    const menus = [{ id: 'original-file' }, { id: 'original-help', submenu: [] }];

    expect(transform(null)).toBeNull();
    expect(transform([])).toEqual([]);
    expect(transform([{ id: 'original-help' }])).toEqual([{ id: 'original-help' }]);
    expect(transform(menus)).toEqual(menus);
  });
});
