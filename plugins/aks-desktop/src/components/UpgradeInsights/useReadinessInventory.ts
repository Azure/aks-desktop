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

export function useReadinessInventory(provider: InsightsProvider, refresh: number) {
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

export function usePageRecords(provider: InsightsProvider, clusters: Cluster[], refresh: number) {
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
