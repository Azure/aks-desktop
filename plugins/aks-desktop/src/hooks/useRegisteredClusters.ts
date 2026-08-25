// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useMemo } from 'react';
import { reconcileRegisteredClusterNames } from '../utils/azure/aks';

/**
 * Returns a Set of cluster names already registered in Headlamp.
 * Used to avoid re-registering clusters (which would overwrite kubeconfig
 * with namespace-scoped credentials).
 */
export function useRegisteredClusters(): Set<string> {
  const clustersConf = K8s.useClustersConf();

  const registeredClusters = useMemo(() => {
    if (!clustersConf) return new Set<string>();
    return new Set(Object.keys(clustersConf));
  }, [clustersConf]);

  useEffect(() => {
    if (clustersConf !== null && clustersConf !== undefined) {
      reconcileRegisteredClusterNames(registeredClusters);
    }
  }, [clustersConf, registeredClusters]);

  return registeredClusters;
}
