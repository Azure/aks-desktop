// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Cluster } from '../../types/upgradeInsights';
import { getClusterSettings } from '../../utils/shared/clusterSettings';

/**
 * Registration metadata can narrow the choices, but does not contain a complete
 * ARM identity. Even one candidate needs explicit selection; never match names.
 * @param clusters Reachable managed-cluster inventory from the selected subscriptions.
 * @param contextName Optional key for persisted registration metadata, not an ARM resource name.
 * @returns Candidates narrowed by complete subscription/resource-group metadata, all candidates
 * when that metadata is absent, or no candidates for an Arc-connected context.
 */
export function contextCandidates(clusters: Cluster[], contextName?: string): Cluster[] {
  if (!contextName) return clusters;
  const settings = getClusterSettings(contextName);
  if (settings.clusterType === 'aksarc') return [];
  const scope = settings.azureRegistration;
  if (
    typeof scope?.subscriptionId !== 'string' ||
    typeof scope.resourceGroup !== 'string' ||
    !scope.subscriptionId ||
    !scope.resourceGroup
  ) {
    return clusters;
  }
  return clusters.filter(
    cluster =>
      cluster.subscription.toLowerCase() === scope.subscriptionId.toLowerCase() &&
      cluster.resourceGroup.toLowerCase() === scope.resourceGroup.toLowerCase()
  );
}
