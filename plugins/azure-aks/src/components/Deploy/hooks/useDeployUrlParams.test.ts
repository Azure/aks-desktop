// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeployUrlParams } from './useDeployUrlParams';

const mockReplace = vi.fn();

let mockLocation = {
  pathname: '/project/123',
  search: '',
};

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ replace: mockReplace }),
  useLocation: () => mockLocation,
}));

describe('useDeployUrlParams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation = { pathname: '/project/123', search: '' };
  });

  it.each([
    { search: '', expectedOpen: false, expectedAppName: undefined },
    { search: '?openDeploy=false', expectedOpen: false, expectedAppName: undefined },
    { search: '?openDeploy=true', expectedOpen: true, expectedAppName: undefined },
    {
      search: '?openDeploy=true&applicationName=my-app',
      expectedOpen: true,
      expectedAppName: 'my-app',
    },
  ])(
    'should parse URL "$search" -> shouldOpenDialog=$expectedOpen, appName=$expectedAppName',
    async ({ search, expectedOpen, expectedAppName }) => {
      mockLocation.search = search;
      const { result } = renderHook(() => useDeployUrlParams());

      await waitFor(() => {
        expect(result.current.shouldOpenDialog).toBe(expectedOpen);
        expect(result.current.initialApplicationName).toBe(expectedAppName);
      });
    }
  );

  it.each([
    { search: '?openDeploy=true', expectedPath: '/project/123' },
    { search: '?openDeploy=true&applicationName=app', expectedPath: '/project/123' },
    { search: '?openDeploy=true&foo=bar', expectedPath: '/project/123?foo=bar' },
  ])('should clean URL "$search" -> "$expectedPath"', async ({ search, expectedPath }) => {
    mockLocation.search = search;
    renderHook(() => useDeployUrlParams());

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(expectedPath);
    });
  });

  it('should clear state when clearUrlTrigger is called', async () => {
    mockLocation.search = '?openDeploy=true&applicationName=app';
    const { result } = renderHook(() => useDeployUrlParams());

    await waitFor(() => {
      expect(result.current.shouldOpenDialog).toBe(true);
    });

    // Simulate URL being cleaned (as history.replace would do)
    mockLocation.search = '';

    act(() => {
      result.current.clearUrlTrigger();
    });

    expect(result.current.shouldOpenDialog).toBe(false);
    expect(result.current.initialApplicationName).toBeUndefined();
  });
});
