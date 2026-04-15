// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { deriveBuildContext, useDockerfileDiscovery } from './useDockerfileDiscovery';

describe('deriveBuildContext', () => {
  it('should return . for root Dockerfile', () => {
    expect(deriveBuildContext('Dockerfile')).toBe('.');
  });

  it('should return parent directory for nested Dockerfile', () => {
    expect(deriveBuildContext('src/web/Dockerfile')).toBe('./src/web');
  });

  it('should handle single-level nesting', () => {
    expect(deriveBuildContext('app/Dockerfile')).toBe('./app');
  });
});

describe('useDockerfileDiscovery', () => {
  it('should auto-select when exactly one Dockerfile is provided', () => {
    const { result } = renderHook(() => useDockerfileDiscovery(['Dockerfile']));
    expect(result.current.selection).toEqual({
      path: 'Dockerfile',
      buildContext: '.',
    });
  });

  it('should not auto-select when multiple Dockerfiles are provided', () => {
    const { result } = renderHook(() => useDockerfileDiscovery(['Dockerfile', 'src/Dockerfile']));
    expect(result.current.selection).toBeNull();
  });

  it('should not auto-select when no Dockerfiles are provided', () => {
    const { result } = renderHook(() => useDockerfileDiscovery([]));
    expect(result.current.selection).toBeNull();
  });

  it('should not auto-select when paths is null (not yet fetched)', () => {
    const { result } = renderHook(() => useDockerfileDiscovery(null));
    expect(result.current.selection).toBeNull();
  });

  it('should auto-select when dockerfilePaths changes from empty to single', () => {
    const { result, rerender } = renderHook(
      (paths: string[] | null) => useDockerfileDiscovery(paths),
      { initialProps: [] as string[] | null }
    );
    expect(result.current.selection).toBeNull();

    rerender(['src/web/Dockerfile']);
    expect(result.current.selection).toEqual({
      path: 'src/web/Dockerfile',
      buildContext: './src/web',
    });
  });

  it('should auto-select when dockerfilePaths changes from null to single', () => {
    const { result, rerender } = renderHook(
      (paths: string[] | null) => useDockerfileDiscovery(paths),
      { initialProps: null as string[] | null }
    );
    expect(result.current.selection).toBeNull();

    rerender(['Dockerfile']);
    expect(result.current.selection).toEqual({
      path: 'Dockerfile',
      buildContext: '.',
    });
  });

  it('should clear stale selection when dockerfilePaths changes', () => {
    const { result, rerender } = renderHook(
      (paths: string[] | null) => useDockerfileDiscovery(paths),
      { initialProps: ['Dockerfile'] as string[] | null }
    );
    expect(result.current.selection?.path).toBe('Dockerfile');

    rerender(['src/api/Dockerfile']);
    expect(result.current.selection).toEqual({
      path: 'src/api/Dockerfile',
      buildContext: './src/api',
    });
  });

  it('should preserve selection when path is still in the list', () => {
    const { result, rerender } = renderHook(
      (paths: string[] | null) => useDockerfileDiscovery(paths),
      { initialProps: ['Dockerfile', 'src/Dockerfile'] as string[] | null }
    );
    act(() => result.current.setSelectedPath('src/Dockerfile'));
    expect(result.current.selection?.path).toBe('src/Dockerfile');

    rerender(['Dockerfile', 'src/Dockerfile', 'app/Dockerfile']);
    expect(result.current.selection?.path).toBe('src/Dockerfile');
  });

  it('should select a Dockerfile by path', () => {
    const { result } = renderHook(() =>
      useDockerfileDiscovery(['Dockerfile', 'src/web/Dockerfile'])
    );

    act(() => result.current.setSelectedPath('src/web/Dockerfile'));
    expect(result.current.selection).toEqual({
      path: 'src/web/Dockerfile',
      buildContext: './src/web',
    });
  });

  it('should ignore setSelectedPath calls with paths not in the list', () => {
    const { result } = renderHook(() => useDockerfileDiscovery(['Dockerfile']));

    act(() => result.current.setSelectedPath('nonexistent/Dockerfile'));
    // Auto-selected 'Dockerfile' should remain unchanged
    expect(result.current.selection?.path).toBe('Dockerfile');
  });

  it('should override build context', () => {
    const { result } = renderHook(() => useDockerfileDiscovery(['src/web/Dockerfile']));
    expect(result.current.selection?.buildContext).toBe('./src/web');

    act(() => result.current.setBuildContext('.'));
    expect(result.current.selection).toEqual({
      path: 'src/web/Dockerfile',
      buildContext: '.',
    });
  });

  it('should not expose dockerfilePaths in return value', () => {
    const paths = ['Dockerfile', 'src/Dockerfile'];
    const { result } = renderHook(() => useDockerfileDiscovery(paths));
    expect('dockerfilePaths' in result.current).toBe(false);
  });
});
