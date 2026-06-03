// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getInstallId } from './installId';

afterEach(() => {
  delete (window as any).desktopApi;
});

describe('getInstallId', () => {
  it('returns the UUID provided by desktopApi.getInstallId', async () => {
    (window as any).desktopApi = {
      getInstallId: vi.fn().mockResolvedValue('11111111-1111-4111-8111-111111111111'),
    };
    const id = await getInstallId();
    expect(id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('returns undefined when desktopApi is absent (web mode)', async () => {
    expect(await getInstallId()).toBeUndefined();
  });

  it('returns undefined when desktopApi.getInstallId is absent', async () => {
    (window as any).desktopApi = {};
    expect(await getInstallId()).toBeUndefined();
  });

  it('returns undefined and does not throw when the IPC call fails', async () => {
    (window as any).desktopApi = {
      getInstallId: vi.fn().mockRejectedValue(new Error('IPC failed')),
    };
    expect(await getInstallId()).toBeUndefined();
  });

  it('returns undefined when the IPC returns a non-UUID value', async () => {
    (window as any).desktopApi = {
      getInstallId: vi.fn().mockResolvedValue('not-a-uuid'),
    };
    expect(await getInstallId()).toBeUndefined();
  });
});
