// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useState } from 'react';
import { runCommandAsync } from '../../../utils/azure/az-cli';

const PROJECT_ID_LABEL = 'headlamp.dev/project-id';
const PROJECT_MANAGED_BY_LABEL = 'headlamp.dev/project-managed-by';
const PROJECT_MANAGED_BY_VALUE = 'aks-desktop';

export interface DiscoveredNamespace {
  name: string;
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
  labels: Record<string, string> | null;
  provisioningState: string;
  category: 'needs-conversion' | 'needs-import';
}

export interface UseNamespaceDiscoveryReturn {
  namespaces: DiscoveredNamespace[];
  needsConversion: DiscoveredNamespace[];
  needsImport: DiscoveredNamespace[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function getClusterName(resourceId: string): string {
  const m = resourceId.match(/managedClusters\/([^/]+)/);
  return m ? m[1] : '';
}

// System namespaces to filter out
const SYSTEM_NAMESPACES = new Set([
  'kube-system',
  'kube-public',
  'kube-node-lease',
  'default',
  'gatekeeper-system',
]);

function categorizeNamespace(ns: {
  labels: Record<string, string> | null;
}): 'needs-conversion' | 'needs-import' {
  const hasProjectId = ns.labels?.[PROJECT_ID_LABEL];
  const hasManagedBy = ns.labels?.[PROJECT_MANAGED_BY_LABEL] === PROJECT_MANAGED_BY_VALUE;

  if (hasProjectId && hasManagedBy) {
    return 'needs-import';
  }
  return 'needs-conversion';
}

function isAlreadyImported(ns: { name: string; clusterName: string }): boolean {
  try {
    const settings = JSON.parse(localStorage.getItem(`cluster_settings.${ns.clusterName}`) || '{}');
    const allowedNamespaces: string[] = settings.allowedNamespaces ?? [];
    return allowedNamespaces.includes(ns.name);
  } catch {
    return false;
  }
}

/**
 * Hook to discover managed namespaces across Azure subscriptions via Resource Graph.
 * Categorizes them as needing conversion (no project labels) or import (already labeled).
 */
export const useNamespaceDiscovery = (): UseNamespaceDiscoveryReturn => {
  const [namespaces, setNamespaces] = useState<DiscoveredNamespace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discover = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const query = `resources | where type =~ 'microsoft.containerservice/managedclusters/managednamespaces' | project id, name, resourceGroup, subscriptionId, labels=properties['labels'], provisioningState=properties['provisioningState']`;

      const isWindows = (window as any).desktopApi?.platform === 'win32';

      const { stdout, stderr } = await runCommandAsync('az', [
        'graph',
        'query',
        '-q',
        isWindows ? `"${query}"` : query,
        '--output',
        'json',
      ]);

      if (stderr) {
        throw new Error(stderr);
      }

      const data = JSON.parse(stdout).data;

      const discovered: DiscoveredNamespace[] = data
        .map((item: any) => {
          const name = item.name;
          const clusterName = getClusterName(item.id);
          const labels = item.labels || null;
          const provisioningState = item.provisioningState || '';

          return {
            name,
            clusterName,
            resourceGroup: item.resourceGroup,
            subscriptionId: item.subscriptionId,
            labels,
            provisioningState,
            category: categorizeNamespace({ labels }),
          };
        })
        .filter((ns: DiscoveredNamespace) => {
          // Filter out system namespaces
          if (SYSTEM_NAMESPACES.has(ns.name)) return false;
          // Filter out non-succeeded namespaces
          if (ns.provisioningState && ns.provisioningState.toLowerCase() !== 'succeeded')
            return false;
          // Filter out already-imported namespaces
          if (ns.category === 'needs-import' && isAlreadyImported(ns)) return false;
          return true;
        });

      setNamespaces(discovered);
    } catch (err) {
      console.error('Failed to discover managed namespaces:', err);
      setError(err instanceof Error ? err.message : 'Failed to discover managed namespaces');
      setNamespaces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    discover();
  }, [discover]);

  const needsConversion = namespaces.filter(ns => ns.category === 'needs-conversion');
  const needsImport = namespaces.filter(ns => ns.category === 'needs-import');

  return {
    namespaces,
    needsConversion,
    needsImport,
    loading,
    error,
    refresh: discover,
  };
};
