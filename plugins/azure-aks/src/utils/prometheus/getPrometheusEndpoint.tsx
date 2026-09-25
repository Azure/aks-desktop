// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { azureCredential } from '../../azureAuth';
import { isValidGuid } from '../azure/az-helpers';

/**
 * Fetches Prometheus endpoint for a given cluster via Azure Resource Graph.
 *
 * @param resourceGroup - Resource group containing the cluster.
 * @param clusterName - Name of target cluster.
 * @param subscription - Azure subscription ID.
 * @returns The Prometheus query endpoint URL.
 */
export async function getPrometheusEndpoint(
  resourceGroup: string,
  clusterName: string,
  subscription: string
): Promise<string> {
  if (!subscription || !isValidGuid(subscription)) {
    throw new Error('Invalid subscription ID format');
  }

  // Sanitize interpolated values to prevent KQL injection.
  if (!/^[a-zA-Z0-9_-]+$/.test(resourceGroup) || !/^[a-zA-Z0-9_-]+$/.test(clusterName)) {
    throw new Error('Invalid resource group or cluster name format');
  }

  const query = `
    resources
    | where type =~ 'microsoft.alertsmanagement/prometheusrulegroups'
    | where resourceGroup =~ '${resourceGroup}'
    | where properties.clusterName == '${clusterName}'
    | mv-expand workspaceId = properties.scopes
    | project workspaceId = tolower(tostring(workspaceId))
    | join kind=inner (
        resources
        | where type =~ 'microsoft.monitor/accounts'
        | project workspaceId = tolower(id), prometheusEndpoint = properties.metrics.prometheusQueryEndpoint
    ) on workspaceId
    | project prometheusEndpoint
  `;

  const client = new ResourceGraphClient(azureCredential);
  const result = await client.resources({
    query,
    subscriptions: [subscription],
  });

  const data = (result.data as any[]) || [];

  if (data.length === 0) {
    throw new Error(
      'Azure Monitor Metrics (Managed Prometheus) does not appear to be configured for this cluster. ' +
        `To enable it, run: az aks update --resource-group ${resourceGroup} --name ${clusterName} --enable-azure-monitor-metrics.` +
        ' See docs/cluster-requirements.md for full cluster requirements.'
    );
  }

  return String(data[0].prometheusEndpoint).trim();
}
