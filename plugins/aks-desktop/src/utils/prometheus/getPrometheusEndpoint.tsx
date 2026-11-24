// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { getAzureCloudEndpoints } from '../azure/az-cloud';
import {
  azListAll,
  azRequest,
  type AzRequestOptions,
  AzureRequestError,
  createAzureRequestSignal,
} from '../azure/az-http';
import { getSubscriptionCredential } from '../azure/az-token';

const RULE_GROUPS_API_VERSION = '2023-03-01';
const MONITOR_ACCOUNT_API_VERSION = '2023-04-03';
const MONITOR_ACCOUNT_SCOPE_PATTERN =
  /^\/subscriptions\/([^/?#]+)\/resourceGroups\/[^/?#]+\/providers\/Microsoft\.Monitor\/accounts\/[^/?#]+$/i;

/** Subset of an ARM `Microsoft.AlertsManagement/prometheusRuleGroups` resource inspected for cluster scope discovery. */
interface PrometheusRuleGroup {
  /** Rule group resource name. */
  name?: string;
  /** Rule group properties containing cluster association and linked monitor scopes. */
  properties?: {
    /** AKS cluster name associated with the rule group. */
    clusterName?: string;
    /** ARM resource IDs of linked Azure Monitor workspaces. */
    scopes?: unknown;
  };
}

/** Subset of an ARM `Microsoft.Monitor/accounts` resource inspected for its Prometheus query endpoint. */
interface MonitorAccountResource {
  /** Monitor account properties. */
  properties?: {
    /** Metrics ingestion and query configuration. */
    metrics?: {
      /** HTTPS Prometheus query endpoint URL. */
      prometheusQueryEndpoint?: unknown;
    };
  };
}

/**
 * Checks whether a trimmed string is a relative dot path segment (`.` or `..`).
 *
 * @param value - Input string to validate before interpolating into an ARM URL path.
 * @returns `true` if the trimmed value is `.` or `..`.
 */
function isDotSegment(value: string): boolean {
  return value.trim() === '.' || value.trim() === '..';
}

/**
 * Fetches Prometheus query endpoint for a given AKS cluster via ARM REST.
 * Lists Prometheus rule groups (`2023-03-01`) in the cluster's resource group,
 * matches `properties.clusterName`, and reads `properties.metrics.prometheusQueryEndpoint`
 * from the linked Azure Monitor workspace (`2023-04-03`).
 *
 * @param resourceGroup - Resource group containing the cluster.
 * @param clusterName - Name of target cluster.
 * @param subscription - Azure subscription ID.
 * @param options - Optional REST transport, credential, or cancellation overrides.
 * @returns The validated HTTPS Prometheus query endpoint URL.
 * @throws {AzureRequestError} For invalid inputs or missing/invalid/non-HTTPS workspace endpoints.
 * @throws {Error} When no matching Prometheus rule group or valid workspace scope is found.
 */
export async function getPrometheusEndpoint(
  resourceGroup: string,
  clusterName: string,
  subscription: string,
  options: Pick<
    AzRequestOptions,
    'credential' | 'endpoint' | 'scope' | 'tenantId' | 'signal' | 'timeoutMs'
  > = {}
): Promise<string> {
  if (
    !resourceGroup?.trim() ||
    !clusterName?.trim() ||
    !subscription?.trim() ||
    isDotSegment(resourceGroup) ||
    isDotSegment(subscription)
  ) {
    throw new AzureRequestError('Resource group, cluster name, and subscription are required');
  }

  const linked = createAzureRequestSignal(options.signal, options.timeoutMs);
  try {
    const credential = options.credential ?? getSubscriptionCredential(subscription);
    const cloud =
      !options.credential && (!options.endpoint || !options.scope)
        ? await getAzureCloudEndpoints(undefined, linked.signal)
        : undefined;
    const baseRequest = {
      ...options,
      endpoint: options.endpoint ?? cloud?.endpoint,
      scope: options.scope ?? cloud?.scope,
      signal: linked.signal,
      credential,
    };

    const ruleGroupsUrl =
      `/subscriptions/${encodeURIComponent(subscription)}` +
      `/resourceGroups/${encodeURIComponent(resourceGroup)}` +
      '/providers/Microsoft.AlertsManagement/prometheusRuleGroups';

    const ruleGroups = await azListAll<PrometheusRuleGroup>({
      ...baseRequest,
      url: ruleGroupsUrl,
      apiVersion: RULE_GROUPS_API_VERSION,
    });

    if (ruleGroups.length === 0) {
      throw new Error(
        'Azure Monitor Metrics (Managed Prometheus) does not appear to be configured for this cluster. ' +
          `To enable it, run: az aks update --resource-group ${resourceGroup} --name ${clusterName} --enable-azure-monitor-metrics.` +
          ' See docs/cluster-requirements.md for full cluster requirements.'
      );
    }

    const matchingGroups = ruleGroups.filter(rg => rg.properties?.clusterName === clusterName);
    if (matchingGroups.length === 0) {
      throw new Error(
        `No Prometheus workspace found for cluster '${clusterName}'. ` +
          'Ensure Azure Monitor Metrics is enabled. ' +
          `To enable it, run: az aks update --resource-group ${resourceGroup} --name ${clusterName} --enable-azure-monitor-metrics.` +
          ' See docs/cluster-requirements.md for full cluster requirements.'
      );
    }

    const workspaceScope = matchingGroups
      .flatMap(rg => (Array.isArray(rg.properties?.scopes) ? rg.properties.scopes : []))
      .find(
        (scope): scope is string =>
          typeof scope === 'string' && MONITOR_ACCOUNT_SCOPE_PATTERN.test(scope.trim())
      )
      ?.trim();

    if (!workspaceScope) {
      throw new Error('Rule group has no valid Azure Monitor workspace scopes defined');
    }

    const workspaceSubId = MONITOR_ACCOUNT_SCOPE_PATTERN.exec(workspaceScope)![1];
    const workspaceCredential =
      options.credential ??
      (workspaceSubId.toLowerCase() === subscription.toLowerCase()
        ? credential
        : getSubscriptionCredential(workspaceSubId));

    const workspace = await azRequest<MonitorAccountResource>({
      ...baseRequest,
      credential: workspaceCredential,
      url: workspaceScope,
      apiVersion: MONITOR_ACCOUNT_API_VERSION,
    });

    const queryEndpoint = workspace?.properties?.metrics?.prometheusQueryEndpoint;
    if (typeof queryEndpoint !== 'string' || !queryEndpoint.trim()) {
      throw new AzureRequestError('Azure Monitor workspace is missing prometheusQueryEndpoint');
    }

    const trimmedEndpoint = queryEndpoint.trim().replace(/\/+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(trimmedEndpoint);
    } catch {
      throw new AzureRequestError('Azure Monitor workspace returned an invalid endpoint URL');
    }
    if (parsed.protocol !== 'https:') {
      throw new AzureRequestError('Prometheus query endpoint must use HTTPS');
    }

    return trimmedEndpoint;
  } catch (error) {
    console.error('MetricsTab: Failed to get Prometheus endpoint:', error);
    throw error;
  } finally {
    linked.dispose();
  }
}
