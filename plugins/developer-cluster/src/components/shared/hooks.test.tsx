// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiServerReady } from '../../native/apiServerProbe';
import { finishedOverviewRefreshes, refreshOverview } from '../../workflow/setup';
import { update } from '../../workflow/store';
import {
  STATUS_PROBE_INTERVAL_MS,
  useApiServerStatus,
  useClusterListRefresh,
  useOverviewRefresh,
  useWorkflow,
} from './hooks';

/** The cluster list Headlamp reports, by name. */
let clustersConf: Record<string, unknown> | null = null;

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useClustersConf: () => clustersConf },
}));

vi.mock('../../native/apiServerProbe', () => ({ apiServerReady: vi.fn() }));

vi.mock('../../workflow/setup', () => ({
  finishedOverviewRefreshes: vi.fn(),
  refreshOverview: vi.fn(),
}));

/** Opens Overview: the hook with the rendered workflow state. */
function openOverview() {
  return renderHook(() => useOverviewRefresh(useWorkflow().busy));
}

describe('useOverviewRefresh', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(finishedOverviewRefreshes).mockReturnValue(3);
    update({ busy: false });
  });

  it('refreshes once when Overview opens with no operation running', () => {
    const { rerender } = openOverview();
    act(() => update({ busy: true }));
    act(() => update({ busy: false }));
    rerender();

    expect(refreshOverview).toHaveBeenCalledOnce();
  });

  it('refreshes once the operation running when Overview opened ends', () => {
    update({ busy: true });
    openOverview();
    expect(refreshOverview).not.toHaveBeenCalled();

    act(() => update({ busy: false }));
    act(() => update({ busy: true }));
    act(() => update({ busy: false }));

    expect(refreshOverview).toHaveBeenCalledOnce();
  });

  it('skips its refresh when an Overview refresh finished while it waited', () => {
    update({ busy: true });
    openOverview();

    // A failed Delete refreshes Overview itself before the workflow is idle again.
    vi.mocked(finishedOverviewRefreshes).mockReturnValue(4);
    act(() => update({ busy: false }));

    expect(refreshOverview).not.toHaveBeenCalled();
  });
});

describe('useApiServerStatus', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Lets pending probes settle, then advances the clock by `ms`. */
  async function wait(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it('keeps probing while Overview is open, following a starting and a stopped API server', async () => {
    vi.mocked(apiServerReady)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const { result } = renderHook(() => useApiServerStatus('dev-cluster'));
    await wait(0);
    expect(result.current).toBe('unreachable');

    await wait(STATUS_PROBE_INTERVAL_MS);
    expect(result.current).toBe('active');
    await wait(STATUS_PROBE_INTERVAL_MS);
    expect(result.current).toBe('active');
    await wait(STATUS_PROBE_INTERVAL_MS);
    expect(result.current).toBe('unreachable');

    expect(apiServerReady).toHaveBeenCalledTimes(4);
    expect(apiServerReady).toHaveBeenCalledWith('dev-cluster');
  });

  it('stops probing when Overview closes', async () => {
    vi.mocked(apiServerReady).mockResolvedValue(false);
    const { unmount } = renderHook(() => useApiServerStatus('dev-cluster'));
    await wait(0);
    unmount();

    await wait(STATUS_PROBE_INTERVAL_MS * 3);
    expect(apiServerReady).toHaveBeenCalledOnce();
  });
});

describe('useClusterListRefresh', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clustersConf = { minikube: {} };
    update({ busy: false });
  });

  /** Opens Overview: the hook with the rendered workflow state. */
  function openOverviewList() {
    return renderHook(() => useClusterListRefresh(useWorkflow().busy));
  }

  it('refreshes Overview once when the cluster names change', () => {
    const { rerender } = openOverviewList();
    rerender();
    expect(refreshOverview).not.toHaveBeenCalled();

    clustersConf = { minikube: {}, 'dev-cluster': {} };
    rerender();
    rerender();
    expect(refreshOverview).toHaveBeenCalledOnce();
  });

  it('refreshes once the operation that ran during a change ends', () => {
    const { rerender } = openOverviewList();
    act(() => update({ busy: true }));
    clustersConf = {};
    rerender();
    expect(refreshOverview).not.toHaveBeenCalled();

    act(() => update({ busy: false }));
    act(() => update({ busy: true }));
    act(() => update({ busy: false }));
    expect(refreshOverview).toHaveBeenCalledOnce();
  });
});
