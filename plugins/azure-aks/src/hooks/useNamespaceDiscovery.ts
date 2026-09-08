// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { azureCredential } from '../azureAuth';
import {
  PROJECT_ID_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
} from '../utils/constants/projectLabels';
import { getClusterSettings } from '../utils/shared/clusterSettings';

export interface DiscoveredNamespace {
  name: string;
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
  labels: Record<string, string> | null;
  provisioningState: string;
  /** Whether this namespace already has AKS Desktop project labels */
  isAksProject: boolean;
  /** Whether this is an AKS managed namespace (vs regular K8s namespace) */
  isManagedNamespace: boolean;
  /** Categorization for UI display purposes */
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

// System and infrastructure namespaces to filter out
const SYSTEM_NAMESPACES = new Set([
  'kube-system',
  'kube-public',
  'kube-node-lease',
  'default',
  'gatekeeper-system',
  'calico-system',
  'tigera-operator',
  'cert-manager',
  'ingress-nginx',
  'kube-flannel',
  'azure-arc',
  'azure-extensions-usage-system',
  'local-path-storage',
]);

function isAksDesktopProject(labels: Record<string, string> | null): boolean {
  if (!labels) return false;
  return (
    !!labels[PROJECT_ID_LABEL] && labels[PROJECT_MANAGED_BY_LABEL] === PROJECT_MANAGED_BY_VALUE
  );
}

function isAlreadyImported(ns: {
  name: string;
  clusterName: string;
  isAksProject: boolean;
}): boolean {
  // Only treat as "already imported" if it's in allowedNamespaces AND has project labels.
  // Namespaces can end up in allowedNamespaces without labels (e.g., cluster registered with
  // namespace-scoped credentials, or a prior conversion that failed). These should still appear
  // so the user can convert them.
  if (!ns.isAksProject) return false;
  const settings = getClusterSettings(ns.clusterName);
  const allowedNamespaces: string[] = settings.allowedNamespaces ?? [];
  return allowedNamespaces.includes(ns.name);
}

/**
 * Fetches all namespaces from a single registered cluster via the K8s API.
 * Returns an array of DiscoveredNamespace entries with isManagedNamespace=false.
 */
function fetchRegularNamespacesForCluster(clusterName: string): Promise<DiscoveredNamespace[]> {
  return new Promise(resolve => {
    let cancelFn: Promise<() => void> | null = null;
    // Guard against the K8s apiList calling both success and error callbacks
    let settled = false;

    const cleanup = () => {
      if (cancelFn) {
        void Promise.resolve(cancelFn).then(cancel => {
          if (typeof cancel === 'function') cancel();
        });
      }
    };

    cancelFn = K8s.ResourceClasses.Namespace.apiList(
      (namespaces: any[]) => {
        if (settled) return;
        settled = true;
        cleanup();

        const results: DiscoveredNamespace[] = namespaces
          .map((ns: any) => {
            // Headlamp apiList returns objects with `jsonData` wrapper; fall back to direct `metadata` access
            const name: string = ns.jsonData?.metadata?.name || ns.metadata?.name || '';
            const labels: Record<string, string> | null =
              ns.jsonData?.metadata?.labels || ns.metadata?.labels || null;
            const isProject = isAksDesktopProject(labels);

            const category: DiscoveredNamespace['category'] = isProject
              ? 'needs-import'
              : 'needs-conversion';
            return {
              name,
              clusterName,
              resourceGroup: '',
              subscriptionId: '',
              labels,
              provisioningState: 'Succeeded',
              isAksProject: isProject,
              isManagedNamespace: false,
              category,
            };
          })
          .filter((ns: DiscoveredNamespace) => {
            if (!ns.name) return false;
            if (SYSTEM_NAMESPACES.has(ns.name)) return false;
            if (isAlreadyImported(ns)) return false;
            return true;
          });
        resolve(results);
      },
      (err: any) => {
        if (settled) return;
        settled = true;
        cleanup();
        console.warn(`Failed to list namespaces for cluster ${clusterName}:`, err);
        resolve([]);
      },
      {
        cluster: clusterName,
      }
    )();
  });
}

/**
 * Hook to discover both managed namespaces (via Azure Resource Graph) and regular
 * Kubernetes namespaces (via the K8s API on registered clusters).
 * Returns all discoverable namespaces with their AKS project status and categorization.
 */
export const useNamespaceDiscovery = (): UseNamespaceDiscoveryReturn => {
  const [namespaces, setNamespaces] = useState<DiscoveredNamespace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequestIdRef = useRef(0);
  const clustersConf = K8s.useClustersConf();

  // Produce a stable string key from cluster names so that `discover` (below)
  // is only recreated when the actual set of registered clusters changes,
  // not every time clustersConf returns a new object reference.
  const { registeredClusterNames, registeredClusterNamesKey } = useMemo(() => {
    if (!clustersConf)
      return { registeredClusterNames: [] as string[], registeredClusterNamesKey: '' };
    const names = Object.keys(clustersConf).sort();
    return { registeredClusterNames: names, registeredClusterNamesKey: names.join(',') };
  }, [clustersConf]);

  const discover = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    const isStale = () => latestRequestIdRef.current !== requestId;

    setLoading(true);
    setError(null);
    try {
      // --- Path 1: Managed namespaces via Azure Resource Graph ---
      let managedNsError: string | null = null;
      let managedNamespaces: DiscoveredNamespace[] = [];
      let allManagedNamespaces: DiscoveredNamespace[] = [];
      try {
        const query = `resources | where type =~ 'microsoft.containerservice/managedclusters/managednamespaces' | project id, name, resourceGroup, subscriptionId, labels=properties['labels'], provisioningState=properties['provisioningState']`;

        const client = new ResourceGraphClient(azureCredential);
        const result = await client.resources({ query });
        const data = (result.data as any[]) || [];

        // Map first, then filter separately so we can deduplicate regular
        // namespaces against ALL managed namespaces (including already-imported ones).
        allManagedNamespaces = data.map((item: any) => {
          // Azure Resource Graph returns nested resource names as "parentName/childName"
          // (e.g., "my-cluster/my-namespace"). Extract only the namespace portion.
          const rawName: string = item.name ?? '';
          const name = rawName.includes('/') ? rawName.split('/').pop()! : rawName;
          const clusterName = getClusterName(item.id);
          const labels = item.labels || null;
          const provisioningState = item.provisioningState || '';
          const isProject = isAksDesktopProject(labels);

          const category: DiscoveredNamespace['category'] = isProject
            ? 'needs-import'
            : 'needs-conversion';
          return {
            name,
            clusterName,
            resourceGroup: item.resourceGroup,
            subscriptionId: item.subscriptionId,
            labels,
            provisioningState,
            isAksProject: isProject,
            isManagedNamespace: true,
            category,
          };
        });

        const registeredSet = new Set(registeredClusterNames);
        managedNamespaces = allManagedNamespaces.filter((ns: DiscoveredNamespace) => {
          // Filter out namespaces with malformed resource IDs (no cluster name extractable)
          if (!ns.clusterName) return false;
          // Filter out system namespaces
          if (SYSTEM_NAMESPACES.has(ns.name)) return false;
          // Filter out non-succeeded namespaces
          if (ns.provisioningState && ns.provisioningState.toLowerCase() !== 'succeeded')
            return false;
          // Only filter already-imported namespaces when their cluster is registered.
          // Unregistered clusters may have stale allowedNamespaces in localStorage from
          // a previous registration — filtering those would hide them from both the
          // import list AND the project list (since the cluster isn't active).
          if (registeredSet.has(ns.clusterName) && isAlreadyImported(ns)) return false;
          return true;
        });
      } catch (err) {
        // Log but don't fail — regular namespace discovery can still proceed
        console.warn('Failed to discover managed namespaces:', err);
        managedNsError = err instanceof Error ? err.message : String(err);
      }

      // --- Path 2: Regular namespaces from registered clusters via K8s API ---
      let regularNamespaces: DiscoveredNamespace[] = [];
      try {
        const clusterResults = await Promise.all(
          registeredClusterNames.map(clusterName => fetchRegularNamespacesForCluster(clusterName))
        );
        regularNamespaces = clusterResults.flat();
      } catch (err) {
        console.warn('Failed to discover regular namespaces:', err);
      }

      // --- Merge and deduplicate ---
      // Use ALL managed namespace keys (pre-filter) for deduplication so that
      // managed namespaces discovered via K8s API are always removed in favor
      // of their Resource Graph version — even if that version was filtered by
      // isAlreadyImported. Without this, a managed namespace that was already
      // imported would slip through as a "regular" namespace from the K8s API.
      const allManagedKeys = new Set(
        allManagedNamespaces.map(ns => `${ns.clusterName}/${ns.name}`)
      );
      const deduplicatedRegular = regularNamespaces.filter(
        ns => !allManagedKeys.has(`${ns.clusterName}/${ns.name}`)
      );

      // After dedup against ALL managed namespaces, everything remaining in
      // deduplicatedRegular is a genuinely regular K8s namespace (not in
      // Resource Graph). These should use the K8s API for label updates,
      // not the ARM API — no metadata enrichment needed.
      const allNamespaces = [...managedNamespaces, ...deduplicatedRegular];

      if (isStale()) return;

      if (allNamespaces.length === 0 && managedNsError) {
        setError(managedNsError);
      }

      setNamespaces(allNamespaces);
    } finally {
      if (!isStale()) {
        setLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- registeredClusterNames is derived
    // from registeredClusterNamesKey in the same useMemo; the key provides stable identity
  }, [registeredClusterNamesKey]);

  useEffect(() => {
    discover();
    return () => {
      latestRequestIdRef.current += 1;
    };
  }, [discover]);

  const needsConversion = useMemo(
    () => namespaces.filter(ns => ns.category === 'needs-conversion'),
    [namespaces]
  );
  const needsImport = useMemo(
    () => namespaces.filter(ns => ns.category === 'needs-import'),
    [namespaces]
  );

  return {
    namespaces,
    needsConversion,
    needsImport,
    loading,
    error,
    refresh: discover,
  };
};
