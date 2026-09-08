// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useLogsTab } from './useLogsTab';

/** Helper to create a minimal KubeObject-shaped resource. */
function makeResource(kind: string, name: string, uid = `uid-${name}`) {
  return {
    kind,
    jsonData: { metadata: { name, uid } },
  } as any;
}

describe('useLogsTab', () => {
  test('returns empty deployments when projectResources is empty', () => {
    const { result } = renderHook(() => useLogsTab([]));

    expect(result.current.deployments).toHaveLength(0);
    expect(result.current.selectedDeployment).toBeUndefined();
    expect(result.current.selectedDeploymentName).toBe('');
  });

  test('filters only Deployment resources from projectResources', () => {
    const resources = [
      makeResource('Deployment', 'app-1'),
      makeResource('Service', 'svc-1'),
      makeResource('Deployment', 'app-2'),
      makeResource('ConfigMap', 'cm-1'),
    ];

    const { result } = renderHook(() => useLogsTab(resources));

    expect(result.current.deployments).toHaveLength(2);
    expect(result.current.deployments[0].jsonData.metadata.name).toBe('app-1');
    expect(result.current.deployments[1].jsonData.metadata.name).toBe('app-2');
  });

  test('auto-selects the first deployment', () => {
    const resources = [makeResource('Deployment', 'app-1'), makeResource('Deployment', 'app-2')];

    const { result } = renderHook(() => useLogsTab(resources));

    expect(result.current.selectedDeploymentName).toBe('app-1');
    expect(result.current.selectedDeployment?.jsonData.metadata.name).toBe('app-1');
  });

  test('setSelectedDeploymentName updates the selected deployment', () => {
    const resources = [makeResource('Deployment', 'app-1'), makeResource('Deployment', 'app-2')];

    const { result } = renderHook(() => useLogsTab(resources));

    expect(result.current.selectedDeploymentName).toBe('app-1');

    act(() => result.current.setSelectedDeploymentName('app-2'));

    expect(result.current.selectedDeploymentName).toBe('app-2');
    expect(result.current.selectedDeployment?.jsonData.metadata.name).toBe('app-2');
  });

  test('does not overwrite a manually selected deployment when resources update', () => {
    const resources = [makeResource('Deployment', 'app-1'), makeResource('Deployment', 'app-2')];
    const { result, rerender } = renderHook(({ r }) => useLogsTab(r), {
      initialProps: { r: resources },
    });

    act(() => result.current.setSelectedDeploymentName('app-2'));

    // Simulate a resources update (e.g. watcher push) with the same deployments
    rerender({ r: [...resources] });

    expect(result.current.selectedDeploymentName).toBe('app-2');
  });

  test('liveReady is true after mount effects have run', async () => {
    const { result } = renderHook(() => useLogsTab([]));

    await act(async () => {});
    expect(result.current.liveReady).toBe(true);
  });

  test('re-selects first deployment when the selected deployment is removed', () => {
    const app1 = makeResource('Deployment', 'app-1');
    const app2 = makeResource('Deployment', 'app-2');
    const { result, rerender } = renderHook(({ r }) => useLogsTab(r), {
      initialProps: { r: [app1, app2] },
    });

    act(() => result.current.setSelectedDeploymentName('app-2'));
    expect(result.current.selectedDeploymentName).toBe('app-2');

    // app-2 is removed from resources
    rerender({ r: [app1] });

    expect(result.current.selectedDeploymentName).toBe('app-1');
    expect(result.current.selectedDeployment?.jsonData.metadata.name).toBe('app-1');
  });
});
