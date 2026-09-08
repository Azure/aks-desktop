// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useMemo } from 'react';

/**
 * Returns a Set of cluster names already registered in Headlamp.
 * Used to avoid re-registering clusters (which would overwrite kubeconfig
 * with namespace-scoped credentials).
 */
export function useRegisteredClusters(): Set<string> {
  const clustersConf = K8s.useClustersConf();

  return useMemo(() => {
    if (!clustersConf) return new Set<string>();
    return new Set(Object.keys(clustersConf));
  }, [clustersConf]);
}
