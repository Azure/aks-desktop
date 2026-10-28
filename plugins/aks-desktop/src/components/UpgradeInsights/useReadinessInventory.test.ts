// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cluster } from '../../types/upgradeInsights';
import { ArmProvider } from '../../utils/azure/upgrade-insights';
import { cluster } from './__fixtures__/fixtures';
import { usePageRecords } from './useReadinessInventory';

afterEach(cleanup);

describe('readiness cache after a refresh event', () => {
  it('refreshes once and reuses cached snapshots for subsequent page, search, and sort changes', async () => {
    const second = { ...cluster, id: `${cluster.id}-second`, name: 'second' };
    const transport = vi.fn().mockResolvedValue({ value: [] });
    const provider = new ArmProvider(transport, [cluster.subscription]);
    const view = renderHook(
      ({ clusters, refresh }: { clusters: Cluster[]; refresh: number }) =>
        usePageRecords(provider, clusters, refresh),
      { initialProps: { clusters: [cluster], refresh: 0 } }
    );
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(transport).toHaveBeenCalledTimes(1);

    provider.invalidateInsights();
    view.rerender({ clusters: [cluster], refresh: 1 });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(transport).toHaveBeenCalledTimes(2);

    view.rerender({ clusters: [second], refresh: 1 });
    await waitFor(() => expect(view.result.current.records[0]?.cluster.id).toBe(second.id));
    expect(transport).toHaveBeenCalledTimes(3);

    view.rerender({ clusters: [cluster], refresh: 1 });
    await waitFor(() => expect(view.result.current.records[0]?.cluster.id).toBe(cluster.id));
    expect(transport).toHaveBeenCalledTimes(3);

    view.rerender({ clusters: [second, cluster], refresh: 1 });
    await waitFor(() => expect(view.result.current.records).toHaveLength(2));
    expect(transport).toHaveBeenCalledTimes(3);

    provider.invalidateInsights();
    view.rerender({ clusters: [second, cluster], refresh: 2 });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(transport).toHaveBeenCalledTimes(5);
  });
});
