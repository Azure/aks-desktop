// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useCallback, useEffect, useState } from 'react';
import {
  listNamespaceRoleAssignments,
  type NamespaceRoleAssignment,
} from '../../../utils/azure/az-namespace-access';
import { RESOURCE_GROUP_LABEL, SUBSCRIPTION_LABEL } from '../../../utils/constants/projectLabels';
import { ACCESS_TAB_CACHE_TTL_MS } from '../../../utils/constants/timing';

/** 1 minute cache scoped to (cluster/namespace) */
const cache = new Map<string, { assignments: NamespaceRoleAssignment[]; ts: number }>();

export interface UseAccessTabResult {
  loading: boolean;
  error: string | null;
  assignments: NamespaceRoleAssignment[];
  // Used to bypass cache
  refresh: () => void;
}

/**
 *
 * Fetches Azure Role Assignments for the given project (if applicable)
 * @param clusters - List of clusters in the project (only first is used)
 * @param namespaces - List of namespaces in the project (only first is used)
 */
export function useAccessTab(project: {
  clusters: string[];
  namespaces: string[];
}): UseAccessTabResult {
  const { t } = useTranslation();
  const clusterName = project.clusters[0];
  const namespaceName = project.namespaces[0];

  const [namespaceInstance] = K8s.ResourceClasses.Namespace.useGet(namespaceName, undefined, {
    cluster: clusterName,
  });
  const subscription = namespaceInstance?.jsonData?.metadata?.labels?.[SUBSCRIPTION_LABEL];
  const resourceGroup = namespaceInstance?.jsonData?.metadata?.labels?.[RESOURCE_GROUP_LABEL];

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<NamespaceRoleAssignment[]>([]);
  const [fetchKey, setFetchKey] = useState(0);

  const cacheKey = `${clusterName}/${namespaceName}`;

  useEffect(() => {
    // Guard - intentionally return early here in case namespace metadata is not yet resolved
    // The loading state is modified only after the role assignments are
    // successfully/unsuccessfully fetched, which is handled further below.
    if (!clusterName || !resourceGroup || !namespaceName) return;

    // Load cache if fresh
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ACCESS_TAB_CACHE_TTL_MS && fetchKey === 0) {
      setAssignments(cached.assignments);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    listNamespaceRoleAssignments({
      clusterName,
      resourceGroup,
      namespaceName,
      subscriptionId: subscription,
    })
      .then(result => {
        if (cancelled) return;
        if (result.success) {
          setAssignments(result.assignments);
          cache.set(cacheKey, { assignments: result.assignments, ts: Date.now() });
        } else {
          setError(t('Failed to load role assignments'));
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t('Failed to load role assignments'));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clusterName, resourceGroup, namespaceName, subscription, fetchKey, cacheKey]);

  const refresh = useCallback(() => {
    cache.delete(cacheKey);
    setFetchKey(key => key + 1);
  }, [cacheKey]);

  return { loading, error, assignments, refresh };
}
