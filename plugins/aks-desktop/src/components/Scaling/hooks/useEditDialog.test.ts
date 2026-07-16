// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockClusterRequest = vi.hoisted(() => vi.fn());
const telemetryMocks = vi.hoisted(() => ({
  trackFeature: vi.fn(),
  trackError: vi.fn(),
}));

vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({
  clusterRequest: mockClusterRequest,
}));

vi.mock('../../../telemetry', () => telemetryMocks);

import type { DeploymentInfo } from './useDeployments';
import { useEditDialog } from './useEditDialog';
import type { HPAInfo } from './useHPAInfo';

const deployment: DeploymentInfo = {
  name: 'my-deploy',
  namespace: 'test-ns',
  replicas: 3,
  availableReplicas: 3,
  readyReplicas: 3,
};

const hpaInfo: HPAInfo = {
  name: 'my-hpa',
  namespace: 'test-ns',
  minReplicas: 2,
  maxReplicas: 8,
  targetCPUUtilization: 70,
  currentCPUUtilization: 45,
  currentReplicas: 3,
  desiredReplicas: 3,
};

describe('useEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClusterRequest.mockResolvedValue({});
  });

  test('emits scaling workflow transitions without resource identifiers', async () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', onSaved)
    );

    act(() => result.current.handleEditClick());
    await act(async () => result.current.handleSave());

    expect(telemetryMocks.trackFeature).toHaveBeenNthCalledWith(1, {
      feature: 'aksd.scaling',
      status: 'opened',
    });
    expect(telemetryMocks.trackFeature).toHaveBeenNthCalledWith(2, {
      feature: 'aksd.scaling',
      status: 'started',
    });
    expect(telemetryMocks.trackFeature).toHaveBeenNthCalledWith(3, {
      feature: 'aksd.scaling',
      status: 'succeeded',
    });
    expect(telemetryMocks.trackError).not.toHaveBeenCalled();
  });

  test('reports validation failure when required scaling context is missing', async () => {
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, undefined, 'test-cluster', vi.fn())
    );

    await act(async () => result.current.handleSave());

    expect(telemetryMocks.trackFeature).toHaveBeenCalledWith({
      feature: 'aksd.scaling',
      status: 'failed',
    });
    expect(telemetryMocks.trackError).toHaveBeenCalledWith({
      area: 'scaling',
      errorClass: 'ValidationError',
      phase: 'failed',
    });
  });

  test('does not cancel an attempt after it succeeds', async () => {
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', vi.fn())
    );

    act(() => result.current.handleEditClick());
    await act(async () => result.current.handleSave());
    act(() => result.current.handleClose());

    expect(telemetryMocks.trackFeature.mock.calls).toEqual([
      [{ feature: 'aksd.scaling', status: 'opened' }],
      [{ feature: 'aksd.scaling', status: 'started' }],
      [{ feature: 'aksd.scaling', status: 'succeeded' }],
    ]);
    expect(telemetryMocks.trackError).not.toHaveBeenCalled();
  });

  test('does not cancel an attempt after it fails', async () => {
    mockClusterRequest.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', vi.fn())
    );

    act(() => result.current.handleEditClick());
    await act(async () => result.current.handleSave());
    act(() => result.current.handleClose());

    expect(telemetryMocks.trackFeature.mock.calls).toEqual([
      [{ feature: 'aksd.scaling', status: 'opened' }],
      [{ feature: 'aksd.scaling', status: 'started' }],
      [{ feature: 'aksd.scaling', status: 'failed' }],
    ]);
    expect(telemetryMocks.trackError.mock.calls).toEqual([
      [{ area: 'scaling', errorClass: 'UnknownError', phase: 'failed' }],
    ]);
  });

  test('ignores close while a save is in progress', async () => {
    let resolveSave: (() => void) | undefined;
    mockClusterRequest.mockReturnValue(
      new Promise<void>(resolve => {
        resolveSave = resolve;
      })
    );
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', vi.fn())
    );

    act(() => result.current.handleEditClick());
    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.handleSave();
      result.current.handleClose();
    });

    expect(result.current.editDialogOpen).toBe(true);
    expect(telemetryMocks.trackFeature.mock.calls).toEqual([
      [{ feature: 'aksd.scaling', status: 'opened' }],
      [{ feature: 'aksd.scaling', status: 'started' }],
    ]);

    await act(async () => {
      resolveSave?.();
      await savePromise;
    });

    expect(telemetryMocks.trackFeature.mock.calls).toEqual([
      [{ feature: 'aksd.scaling', status: 'opened' }],
      [{ feature: 'aksd.scaling', status: 'started' }],
      [{ feature: 'aksd.scaling', status: 'succeeded' }],
    ]);
  });

  test('keeps a retried save unresolved until the retry reaches a terminal status', async () => {
    mockClusterRequest.mockRejectedValueOnce(new Error('first failure'));
    let rejectRetry: ((error: Error) => void) | undefined;
    mockClusterRequest.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectRetry = reject;
      })
    );
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', vi.fn())
    );

    act(() => result.current.handleEditClick());
    await act(async () => result.current.handleSave());

    let retryPromise!: Promise<void>;
    act(() => {
      retryPromise = result.current.handleSave();
      result.current.handleClose();
    });

    expect(result.current.editDialogOpen).toBe(true);
    expect(telemetryMocks.trackFeature.mock.calls).toEqual([
      [{ feature: 'aksd.scaling', status: 'opened' }],
      [{ feature: 'aksd.scaling', status: 'started' }],
      [{ feature: 'aksd.scaling', status: 'failed' }],
      [{ feature: 'aksd.scaling', status: 'started' }],
    ]);

    await act(async () => {
      rejectRetry?.(new Error('retry failure'));
      await retryPromise;
    });

    expect(telemetryMocks.trackFeature.mock.calls).toEqual([
      [{ feature: 'aksd.scaling', status: 'opened' }],
      [{ feature: 'aksd.scaling', status: 'started' }],
      [{ feature: 'aksd.scaling', status: 'failed' }],
      [{ feature: 'aksd.scaling', status: 'started' }],
      [{ feature: 'aksd.scaling', status: 'failed' }],
    ]);
  });

  test('cancels an unresolved open attempt exactly once', () => {
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', vi.fn())
    );

    act(() => result.current.handleEditClick());
    act(() => {
      result.current.handleClose();
      result.current.handleClose();
    });

    expect(telemetryMocks.trackFeature.mock.calls).toEqual([
      [{ feature: 'aksd.scaling', status: 'opened' }],
      [{ feature: 'aksd.scaling', status: 'cancelled' }],
    ]);
    expect(telemetryMocks.trackError).not.toHaveBeenCalled();
  });

  test('telemetry failures do not change scaling save behavior', async () => {
    telemetryMocks.trackFeature.mockImplementation(() => {
      throw new Error('telemetry unavailable');
    });
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', onSaved)
    );

    await act(async () => result.current.handleSave());

    expect(result.current.saveError).toBeNull();
    expect(onSaved).toHaveBeenCalledOnce();
  });

  test('starts with dialog closed and default form values', () => {
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', vi.fn())
    );

    expect(result.current.editDialogOpen).toBe(false);
    expect(result.current.editValues).toEqual({
      minReplicas: 1,
      maxReplicas: 10,
      targetCPU: 50,
      replicas: 1,
    });
    expect(result.current.saving).toBe(false);
    expect(result.current.saveError).toBeNull();
  });

  test('handleEditClick opens dialog and pre-populates values from HPA', () => {
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], hpaInfo, 'test-ns', 'test-cluster', vi.fn())
    );

    act(() => result.current.handleEditClick());

    expect(result.current.editDialogOpen).toBe(true);
    expect(result.current.editValues).toEqual({
      minReplicas: 2,
      maxReplicas: 8,
      targetCPU: 70,
      replicas: 3,
    });
  });

  test('handleEditClick opens dialog and pre-populates replicas from deployment in manual mode', () => {
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', vi.fn())
    );

    act(() => result.current.handleEditClick());

    expect(result.current.editDialogOpen).toBe(true);
    expect(result.current.editValues).toEqual({
      minReplicas: 1,
      maxReplicas: 10,
      targetCPU: 50,
      replicas: 3,
    });
  });

  test('handleClose closes dialog and clears saveError', async () => {
    mockClusterRequest.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', vi.fn())
    );

    act(() => result.current.handleEditClick());
    await act(async () => result.current.handleSave());

    expect(result.current.saveError).not.toBeNull();

    act(() => result.current.handleClose());

    expect(result.current.editDialogOpen).toBe(false);
    expect(result.current.saveError).toBeNull();
  });

  test('handleSave patches HPA when hpaInfo is present', async () => {
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], hpaInfo, 'test-ns', 'test-cluster', vi.fn())
    );

    act(() => result.current.handleEditClick());
    await act(async () => result.current.handleSave());

    expect(mockClusterRequest).toHaveBeenCalledWith(
      '/apis/autoscaling/v2/namespaces/test-ns/horizontalpodautoscalers/my-hpa',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          spec: { minReplicas: 2, maxReplicas: 8, targetCPUUtilizationPercentage: 70 },
        }),
        cluster: 'test-cluster',
      })
    );
    expect(result.current.editDialogOpen).toBe(false);
    expect(result.current.saveError).toBeNull();
  });

  test('handleSave patches deployment replicas in manual mode', async () => {
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', vi.fn())
    );

    act(() => result.current.handleEditClick());
    await act(async () => result.current.handleSave());

    expect(mockClusterRequest).toHaveBeenCalledWith(
      '/apis/apps/v1/namespaces/test-ns/deployments/my-deploy',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ spec: { replicas: 3 } }),
        cluster: 'test-cluster',
      })
    );
    expect(result.current.editDialogOpen).toBe(false);
  });

  test('handleSave calls onSaved callback after successful save', async () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', onSaved)
    );

    act(() => result.current.handleEditClick());
    await act(async () => result.current.handleSave());

    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test('handleSave sets saveError and keeps dialog open on failure', async () => {
    mockClusterRequest.mockRejectedValue(new Error('forbidden'));
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', vi.fn())
    );

    act(() => result.current.handleEditClick());
    await act(async () => result.current.handleSave());

    expect(result.current.saveError).toContain('forbidden');
    expect(result.current.editDialogOpen).toBe(true);
    expect(result.current.saving).toBe(false);
  });

  test('handleSave does not call onSaved on failure', async () => {
    mockClusterRequest.mockRejectedValue(new Error('forbidden'));
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', onSaved)
    );

    act(() => result.current.handleEditClick());
    await act(async () => result.current.handleSave());

    expect(onSaved).not.toHaveBeenCalled();
  });

  test('handleSave uses "Unknown error" message for non-Error rejections', async () => {
    mockClusterRequest.mockRejectedValue('something went wrong');
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, 'test-ns', 'test-cluster', vi.fn())
    );

    act(() => result.current.handleEditClick());
    await act(async () => result.current.handleSave());

    expect(result.current.saveError).toContain('Unknown error');
  });

  test('handleSave sets saveError and does not call clusterRequest when namespace is undefined', async () => {
    const { result } = renderHook(() =>
      useEditDialog('my-deploy', [deployment], null, undefined, 'test-cluster', vi.fn())
    );

    await act(async () => result.current.handleSave());

    expect(result.current.saveError).toBe('Cannot save: missing namespace, cluster, or deployment');
    expect(mockClusterRequest).not.toHaveBeenCalled();
  });
});
