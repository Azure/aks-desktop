// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppInfo } from './appInfo';

const sample = {
  os: 'linux' as const,
  osMajor: '6.5.0',
  arch: 'x64' as const,
  electronVersion: '31.0.0',
};

afterEach(() => {
  delete (window as any).desktopApi;
});

describe('getAppInfo', () => {
  it('returns the AppInfo provided by desktopApi.getAppInfo', async () => {
    (window as any).desktopApi = {
      getAppInfo: vi.fn().mockResolvedValue(sample),
    };
    expect(await getAppInfo()).toEqual(sample);
  });

  it('returns undefined when desktopApi is absent (web mode)', async () => {
    expect(await getAppInfo()).toBeUndefined();
  });

  it('returns undefined when desktopApi.getAppInfo is absent', async () => {
    (window as any).desktopApi = {};
    expect(await getAppInfo()).toBeUndefined();
  });

  it('returns undefined and does not throw when the IPC call fails', async () => {
    (window as any).desktopApi = {
      getAppInfo: vi.fn().mockRejectedValue(new Error('IPC failed')),
    };
    expect(await getAppInfo()).toBeUndefined();
  });
});
