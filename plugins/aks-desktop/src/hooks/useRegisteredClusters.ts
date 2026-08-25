// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useMemo } from 'react';
import { reconcileRegisteredClusterNames } from '../utils/azure/aks';

/** Authoritative registered-cluster membership derived from Headlamp configuration. */
export interface RegisteredClustersState {
  /** Canonical lowercase names currently registered in Headlamp. */
  registeredClusters: Set<string>;
  /** Whether Headlamp has supplied authoritative cluster configuration. */
  isReady: boolean;
}

/**
 * Returns registered cluster names once Headlamp's cluster config is authoritative.
 *
 * @returns Canonical cluster membership and whether the source configuration is ready.
 */
export function useRegisteredClusters(): RegisteredClustersState {
  const clustersConf = K8s.useClustersConf();
  const isReady = clustersConf !== null && clustersConf !== undefined;

  const registeredClusters = useMemo(() => {
    if (!clustersConf) return new Set<string>();
    return new Set(Object.keys(clustersConf));
  }, [clustersConf]);

  useEffect(() => {
    if (isReady) {
      reconcileRegisteredClusterNames(registeredClusters);
    }
  }, [isReady, registeredClusters]);

  return { registeredClusters, isReady };
}
