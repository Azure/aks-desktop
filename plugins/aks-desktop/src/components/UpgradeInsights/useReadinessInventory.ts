// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useState } from 'react';
import type {
  Cluster,
  ClusterInventory,
  ClusterRecord,
  InsightsProvider,
} from '../../types/upgradeInsights';
import { errorMessage } from './domain';

/** Inventory request state for one provider and refresh token. */
export interface ReadinessInventoryState {
  /** Reachable clusters and explicit subscription/fleet coverage warnings. */
  inventory: ClusterInventory;
  /** Whether the current inventory enumeration is still pending. */
  loading: boolean;
  /** Inventory failure message, empty when the current request has not failed. */
  error: string;
}

/**
 * Enumerate selected subscriptions, aborting obsolete reads and ignoring their late responses.
 * @param provider Data source owned by the current authenticated subscription session.
 * @param refresh Change token that requests another inventory enumeration.
 * @returns Reachable inventory, pending state, and an explicit error rather than synthetic results.
 */
export function useReadinessInventory(
  provider: InsightsProvider,
  refresh: number
): ReadinessInventoryState {
  const [inventory, setInventory] = useState<ClusterInventory>({
    clusters: [],
    warnings: [],
    fleetWarnings: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    provider
      .listClusters(controller.signal)
      .then(inventory => {
        if (!controller.signal.aborted) setInventory(inventory);
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setInventory({ clusters: [], warnings: [], fleetWarnings: [] });
          setError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [provider, refresh]);
  return { inventory, loading, error };
}

/** Completed stored-insight reads for only the visible inventory page. */
export interface PageRecordsState {
  /** Page records including individual read errors; cleared when a replacement page request begins. */
  records: ClusterRecord[];
  /** Whether this page's stored-insight reads are still pending. */
  loading: boolean;
}

/**
 * Read the visible page's independent stored evaluations without computing new evaluations.
 * @param provider Session-owned data source; cleanup aborts reads from a replaced provider.
 * @param clusters Stable array of cluster identities for the current inventory page.
 * @param refresh Change token that re-reads the page using normal provider caching; callers invalidate explicitly.
 * @returns Page records and pending state, retaining per-cluster errors as Unavailable inputs.
 */
export function usePageRecords(
  provider: InsightsProvider,
  clusters: Cluster[],
  refresh: number
): PageRecordsState {
  const [records, setRecords] = useState<ClusterRecord[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setRecords([]);
    setLoading(true);
    Promise.all(
      clusters.map(async cluster => {
        try {
          return {
            cluster,
            insights: await provider.listInsights(cluster, controller.signal),
          };
        } catch (error) {
          return { cluster, insights: [], error: errorMessage(error) };
        }
      })
    ).then(records => {
      if (!controller.signal.aborted) {
        setRecords(records);
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [provider, clusters, refresh]);
  return { records, loading };
}
