// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { configureAzureCliExtensions } from '../../utils/azure/az-cli';
import { runCommandWithOutput } from '../../utils/kubernetes';

// Helper to get Prometheus endpoint
export async function getPrometheusEndpoint(
  resourceGroup: string,
  clusterName: string,
  subscription: string
): Promise<string> {
  try {
    // Configure Azure CLI to auto-install extensions without prompts
    // This allows the az alerts-management command to automatically install the extension if needed
    console.log('Configuring Azure CLI for automatic extension installation...');
    await configureAzureCliExtensions();

    console.log('[getPrometheusEndpoint] Querying prometheus rule groups...');
    console.log('[getPrometheusEndpoint] Parameters:', {
      resourceGroup,
      clusterName,
      subscription,
    });

    // First, get all rule groups as JSON and filter in JavaScript
    // This avoids shell escaping issues with JMESPath queries
    const { stdout: allGroupsStdout, stderr: allGroupsStderr } = await runCommandWithOutput('az', [
      'alerts-management',
      'prometheus-rule-group',
      'list',
      '--resource-group',
      resourceGroup,
      '--output',
      'json',
      '--subscription',
      subscription,
    ]);

    console.log('[getPrometheusEndpoint] All rule groups query result:');
    console.log('[getPrometheusEndpoint]   stdout length:', allGroupsStdout.length);
    console.log('[getPrometheusEndpoint]   stderr:', allGroupsStderr);

    if (!allGroupsStdout.trim()) {
      throw new Error('No prometheus rule groups found in resource group');
    }

    let ruleGroups;
    try {
      ruleGroups = JSON.parse(allGroupsStdout);
      console.log('[getPrometheusEndpoint] Found', ruleGroups.length, 'rule groups');
      console.log(
        '[getPrometheusEndpoint] Rule group names:',
        ruleGroups.map((rg: any) => ({
          name: rg.name,
          clusterName: rg.clusterName,
        }))
      );
    } catch (parseError) {
      console.error('[getPrometheusEndpoint] Failed to parse rule groups JSON:', parseError);
      throw new Error('Failed to parse prometheus rule groups response');
    }

    // Filter for the specific cluster in JavaScript
    const matchingGroup = ruleGroups.find((rg: any) => rg.clusterName === clusterName);

    if (!matchingGroup) {
      console.error('[getPrometheusEndpoint] No rule group found for cluster:', clusterName);
      console.error(
        '[getPrometheusEndpoint] Available clusters:',
        ruleGroups.map((rg: any) => rg.clusterName)
      );
      throw new Error(`No prometheus workspace found for cluster '${clusterName}'`);
    }

    console.log('[getPrometheusEndpoint] Found matching rule group:', matchingGroup.name);

    // Get the workspace scope from the first scope
    const workspaceScope = matchingGroup.scopes?.[0];
    if (!workspaceScope) {
      throw new Error('Rule group has no scopes defined');
    }

    console.log('[getPrometheusEndpoint] Found workspace scope:', workspaceScope);

    const { stdout: endpointStdout } = await runCommandWithOutput('az', [
      'monitor',
      'account',
      'show',
      '--ids',
      workspaceScope,
      '--query',
      'metrics.prometheusQueryEndpoint',
      '--output',
      'tsv',
      '--subscription',
      subscription,
    ]);

    console.log('[getPrometheusEndpoint] Prometheus endpoint:', endpointStdout.trim());

    return endpointStdout.trim();
  } catch (error) {
    console.error('MetricsTab: Failed to get Prometheus endpoint:', error);
    throw error;
  }
}
