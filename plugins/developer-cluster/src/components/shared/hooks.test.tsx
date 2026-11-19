// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finishedOverviewRefreshes, refreshOverview } from '../../workflow/setup';
import { update } from '../../workflow/store';
import { useOverviewRefresh, useWorkflow } from './hooks';

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
