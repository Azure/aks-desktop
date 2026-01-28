// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDialogState } from './useDialogState';

describe('useDialogState', () => {
  it.each([
    { appName: undefined, expectedAppName: undefined },
    { appName: 'my-app', expectedAppName: 'my-app' },
  ])('should open dialog with appName=$appName', ({ appName, expectedAppName }) => {
    const { result } = renderHook(() => useDialogState());

    expect(result.current.open).toBe(false);

    act(() => {
      result.current.openDialog(appName);
    });

    expect(result.current.open).toBe(true);
    expect(result.current.initialApplicationName).toBe(expectedAppName);
  });

  it('should close dialog and clear app name', () => {
    const { result } = renderHook(() => useDialogState());

    act(() => {
      result.current.openDialog('test-app');
    });

    act(() => {
      result.current.closeDialog();
    });

    expect(result.current.open).toBe(false);
    expect(result.current.initialApplicationName).toBeUndefined();
  });
});
