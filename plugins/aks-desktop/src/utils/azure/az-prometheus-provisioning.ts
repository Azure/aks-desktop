// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Managed Prometheus provisioning and cluster addon enablement via ARM REST.
 * Mirrors `azure-cli` 2.90.0 `azuremonitormetrics` (without Grafana) for
 * `azure-monitor-metrics`, and supports combined cluster addon updates (`keda`, `vpa`).
 */

import { getErrorMessage, isValidGuid } from './az-cli-core';
import { getAzureCloudEndpoints } from './az-cloud';
import { type AddonKey } from './az-clusters';
import {
  ARM_ENDPOINT,
  azListAll,
  azRequest,
  type AzRequestOptions,
  azRequestRaw,
  AzureRequestError,
  createAzureRequestSignal,
  waitForAzureRetry,
} from './az-http';
import { type AzureProviderNamespace, registerResourceProvider } from './az-resource-providers';
import { AzTokenError, getSubscriptionCredential } from './az-token';
import { isValidAzResourceGroupName, isValidAzResourceName } from './az-validation';

const AKS_API_VERSION = '2026-01-01';
const RP_PROVIDERS_API_VERSION = '2021-04-01';
const RP_LOCATION_API_VERSION = '2022-01-01';
const AMW_API_VERSION = '2023-04-03';
const DC_API_VERSION = '2022-06-01';
const ALERTS_RECOMMENDATIONS_API_VERSION = '2023-01-01-preview';
const RULES_API_VERSION = '2023-03-01';
const RG_API_VERSION = '2021-04-01';
const PROVISIONING_TIMEOUT_MS = 10 * 60 * 1000;

const REQUIRED_MONITOR_PROVIDERS: AzureProviderNamespace[] = [
  'Microsoft.Insights',
  'Microsoft.AlertsManagement',
  'Microsoft.Monitor',
];

export type EnableClusterAddonOptions = Pick<
  AzRequestOptions,
  'credential' | 'endpoint' | 'scope' | 'tenantId' | 'signal' | 'timeoutMs'
> & {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  addon: AddonKey | AddonKey[];
};

interface ProviderRegistration {
  namespace?: string;
  registrationState?: string;
}

interface ProviderMetadata {
  resourceTypes?: Array<{
    resourceType?: string;
    locations?: string[];
  }>;
}

interface MonitorAccountResource {
  id?: string;
  location?: string;
  properties?: Record<string, unknown>;
}

interface AlertRuleRecommendation {
  name?: string;
  properties?: {
    alertRuleType?: string;
    rulesArmTemplate?: {
      resources?: Array<{
        properties?: {
          rules?: unknown;
        };
      }>;
    };
  };
}

interface OperationStatus {
  status?: string;
  error?: { code?: string; message?: string };
  properties?: {
    provisioningState?: string;
    error?: { code?: string; message?: string };
  };
}

interface ManagedClusterResource {
  id?: string;
  name?: string;
  type?: string;
  eTag?: string;
  location?: string;
  systemData?: unknown;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof AzureRequestError &&
    (error.status === 404 ||
      error.code === 'ResourceNotFound' ||
      error.code === 'ResourceGroupNotFound')
  );
}

function defaultRegionForEndpoint(endpoint: string | undefined): string {
  if (!endpoint) return 'eastus';
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return 'eastus';
  }
  const hasDomain = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
  if (hasDomain('chinacloudapi.cn')) return 'chinanorth3';
  if (hasDomain('usgovcloudapi.net')) return 'usgovvirginia';
  if (hasDomain('microsoft.scloud')) return 'ussecwest';
  if (hasDomain('eaglex.ic.gov')) return 'usnatwest';
  return 'eastus';
}

function resolveMacRegion(
  clusterLocation: string,
  supportedLocations: string[],
  endpoint: string | undefined
): string {
  const normalizedCluster = clusterLocation.toLowerCase().replace(/\s+/g, '');
  if (normalizedCluster === 'centraluseuap') return 'eastus2euap';
  if (supportedLocations.includes(normalizedCluster)) return normalizedCluster;
  if (supportedLocations.length > 0) return supportedLocations[0];
  return defaultRegionForEndpoint(endpoint);
}

function buildDceName(macRegion: string, clusterName: string): string {
  return `MSProm-${macRegion}-${clusterName}`
    .slice(0, 44)
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/[^a-zA-Z0-9]+$/, '');
}

function buildDcrName(macRegion: string, clusterName: string): string {
  return `MSProm-${macRegion}-${clusterName}`.slice(0, 64).replace(/[^a-zA-Z0-9]+$/, '');
}

function hasValidPrometheusRules(
  rules: unknown
): rules is Array<{ record: unknown; expression: unknown }> {
  return (
    Array.isArray(rules) &&
    rules.length > 0 &&
    rules.every(
      rule => rule !== null && typeof rule === 'object' && 'record' in rule && 'expression' in rule
    )
  );
}

const IN_PROGRESS_PROVISIONING_STATES = new Set([
  'creating',
  'updating',
  'accepted',
  'running',
  'deleting',
]);
const TERMINAL_FAILURE_STATES = new Set(['failed', 'canceled', 'cancelled']);

async function pollOperationUntilComplete(
  request: Omit<AzRequestOptions, 'url'> & { apiVersion: string },
  pollTargetUrl: string,
  initialHeaders = new Headers()
): Promise<OperationStatus | undefined> {
  let headers = initialHeaders;
  for (;;) {
    await waitForAzureRetry(headers, request.signal);
    const poll = await azRequestRaw<OperationStatus>({
      ...request,
      url: pollTargetUrl,
      method: 'GET',
      body: undefined,
    });
    headers = poll.headers;
    const status = poll.data?.status?.toLowerCase();
    if (status === 'succeeded') return poll.data;
    if (status && TERMINAL_FAILURE_STATES.has(status)) {
      throw new AzureRequestError(
        poll.data?.error?.message ?? `Provisioning operation ended in ${poll.data?.status}`,
        { code: poll.data?.error?.code }
      );
    }
    if (!status) {
      const provState = poll.data?.properties?.provisioningState?.toLowerCase();
      if (provState === 'succeeded') return poll.data;
      if (provState && TERMINAL_FAILURE_STATES.has(provState)) {
        throw new AzureRequestError(
          poll.data?.properties?.error?.message ??
            `Provisioning operation ended in ${poll.data?.properties?.provisioningState}`,
          { code: poll.data?.properties?.error?.code }
        );
      }
      if (provState && IN_PROGRESS_PROVISIONING_STATES.has(provState)) {
        continue;
      }
      if (poll.status === 200) return poll.data;
    }
  }
}

async function putAndWait(
  request: Omit<AzRequestOptions, 'url'> & { url: string; apiVersion: string; body: unknown }
): Promise<unknown> {
  const response = await azRequestRaw<OperationStatus>({
    ...request,
    method: 'PUT',
  });
  const opHeader =
    response.headers.get('azure-asyncoperation') ??
    response.headers.get('operation-location') ??
    (response.status === 200 ? null : response.headers.get('location'));

  const initialState = response.data?.properties?.provisioningState?.toLowerCase();
  if (!opHeader) {
    if (initialState && TERMINAL_FAILURE_STATES.has(initialState)) {
      throw new AzureRequestError(
        response.data?.properties?.error?.message ??
          `Provisioning operation ended in ${response.data?.properties?.provisioningState}`,
        { code: response.data?.properties?.error?.code }
      );
    }
    if (!initialState || !IN_PROGRESS_PROVISIONING_STATES.has(initialState)) {
      return response.data;
    }
  }

  let pollTargetUrl = request.url;
  if (opHeader) {
    const baseUrl = new URL(request.url, request.endpoint ?? ARM_ENDPOINT);
    const pollUrl = new URL(opHeader, baseUrl);
    if (pollUrl.origin !== baseUrl.origin) {
      throw new AzureRequestError('Refusing to poll provisioning operation on an untrusted host');
    }
    pollTargetUrl = pollUrl.href;
  }

  return pollOperationUntilComplete(request, pollTargetUrl, response.headers);
}

async function ensureMonitorProviders(
  subscriptionId: string,
  baseRequest: Pick<
    AzRequestOptions,
    'credential' | 'endpoint' | 'scope' | 'tenantId' | 'signal' | 'timeoutMs'
  >
): Promise<void> {
  const providers = await azListAll<ProviderRegistration>({
    ...baseRequest,
    url: `/subscriptions/${encodeURIComponent(subscriptionId)}/providers`,
    apiVersion: RP_PROVIDERS_API_VERSION,
  });
  const registered = new Set(
    providers
      .filter(p => p.registrationState?.toLowerCase() === 'registered' && p.namespace)
      .map(p => p.namespace!.toLowerCase())
  );

  for (const ns of REQUIRED_MONITOR_PROVIDERS) {
    if (registered.has(ns.toLowerCase())) continue;
    const result = await registerResourceProvider(ns, subscriptionId, {
      ...baseRequest,
      waitUntilRegistered: true,
    });
    if (!result.success) {
      throw new Error(result.error ?? `Failed to register ${ns}`);
    }
  }
}

async function getSupportedMonitorLocations(
  subscriptionId: string,
  baseRequest: Omit<AzRequestOptions, 'url'>
): Promise<string[]> {
  const metadata = await azRequest<ProviderMetadata>({
    ...baseRequest,
    url: `/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Monitor`,
    apiVersion: RP_LOCATION_API_VERSION,
  });
  const accounts = metadata?.resourceTypes?.find(
    rt => rt.resourceType?.toLowerCase() === 'accounts'
  );
  return (accounts?.locations ?? [])
    .map(loc => loc.toLowerCase().replace(/\s+/g, ''))
    .filter(Boolean);
}

function buildDefaultMonitorWorkspaceCoordinates(
  subscriptionId: string,
  amwRegion: string
): { amwRegion: string; resourceGroup: string; rgUrl: string; amwName: string; amwId: string } {
  const resourceGroup = `DefaultResourceGroup-${amwRegion}`;
  const amwName = `DefaultAzureMonitorWorkspace-${amwRegion}`.slice(0, 43);
  const rgUrl = `/subscriptions/${encodeURIComponent(
    subscriptionId
  )}/resourceGroups/${encodeURIComponent(resourceGroup)}`;
  const amwId = `${rgUrl}/providers/Microsoft.Monitor/accounts/${encodeURIComponent(amwName)}`;
  return { amwRegion, resourceGroup, rgUrl, amwName, amwId };
}

export async function resolveDefaultMonitorWorkspace(
  subscriptionId: string,
  clusterLocation: string,
  baseRequest: Omit<AzRequestOptions, 'url'>
): Promise<{
  amwRegion: string;
  resourceGroup: string;
  rgUrl: string;
  amwName: string;
  amwId: string;
}> {
  const supportedLocations = await getSupportedMonitorLocations(subscriptionId, baseRequest);
  const amwRegion = resolveMacRegion(clusterLocation, supportedLocations, baseRequest.endpoint);
  return buildDefaultMonitorWorkspaceCoordinates(subscriptionId, amwRegion);
}

async function ensureDefaultAzureMonitorWorkspace(
  subscriptionId: string,
  amwRegion: string,
  baseRequest: Omit<AzRequestOptions, 'url'>
): Promise<{ amwId: string; macRegion: string }> {
  const { rgUrl, amwName, amwId } = buildDefaultMonitorWorkspaceCoordinates(
    subscriptionId,
    amwRegion
  );

  let rgExists = true;
  try {
    await azRequest({
      ...baseRequest,
      url: rgUrl,
      apiVersion: RG_API_VERSION,
    });
  } catch (error) {
    if (isNotFound(error)) {
      rgExists = false;
    } else {
      throw error;
    }
  }

  if (rgExists) {
    try {
      const existing = await azRequest<MonitorAccountResource>({
        ...baseRequest,
        url: amwId,
        apiVersion: AMW_API_VERSION,
      });
      if (existing?.location) {
        const state = (existing.properties?.provisioningState as string | undefined)?.toLowerCase();
        if (state && TERMINAL_FAILURE_STATES.has(state)) {
          const propError = existing.properties?.error as
            | { code?: string; message?: string }
            | undefined;
          throw new AzureRequestError(
            propError?.message ??
              `Azure Monitor Workspace '${amwName}' is in terminal state ${existing.properties?.provisioningState}`,
            { code: propError?.code }
          );
        }
        let resolved = existing;
        if (state && IN_PROGRESS_PROVISIONING_STATES.has(state)) {
          resolved =
            ((await pollOperationUntilComplete(
              { ...baseRequest, apiVersion: AMW_API_VERSION },
              amwId
            )) as MonitorAccountResource | undefined) ?? existing;
        }
        return {
          amwId: resolved.id ?? amwId,
          macRegion: (resolved.location ?? existing.location).toLowerCase().replace(/\s+/g, ''),
        };
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  } else {
    await azRequest({
      ...baseRequest,
      url: rgUrl,
      apiVersion: RG_API_VERSION,
      method: 'PUT',
      body: { location: amwRegion },
    });
  }

  const created = (await putAndWait({
    ...baseRequest,
    url: amwId,
    apiVersion: AMW_API_VERSION,
    body: { location: amwRegion, properties: {} },
  })) as MonitorAccountResource | undefined;

  return {
    amwId,
    macRegion: (created?.location ?? amwRegion).toLowerCase().replace(/\s+/g, ''),
  };
}

async function provisionPrometheusArtifacts(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  clusterId: string,
  clusterLocation: string,
  baseRequest: Omit<AzRequestOptions, 'url'>
): Promise<void> {
  await ensureMonitorProviders(subscriptionId, baseRequest);
  const supportedLocations = await getSupportedMonitorLocations(subscriptionId, baseRequest);
  const amwRegion = resolveMacRegion(clusterLocation, supportedLocations, baseRequest.endpoint);
  const { amwId, macRegion } = await ensureDefaultAzureMonitorWorkspace(
    subscriptionId,
    amwRegion,
    baseRequest
  );

  const dceName = buildDceName(macRegion, clusterName);
  const dcrName = buildDcrName(macRegion, clusterName);
  const rgResourcePrefix = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;
  const rgPathPrefix = `/subscriptions/${encodeURIComponent(
    subscriptionId
  )}/resourceGroups/${encodeURIComponent(resourceGroup)}`;
  const dceId = `${rgResourcePrefix}/providers/Microsoft.Insights/dataCollectionEndpoints/${dceName}`;
  const dceUrl = `${rgPathPrefix}/providers/Microsoft.Insights/dataCollectionEndpoints/${encodeURIComponent(
    dceName
  )}`;
  const dcrId = `${rgResourcePrefix}/providers/Microsoft.Insights/dataCollectionRules/${dcrName}`;
  const dcrUrl = `${rgPathPrefix}/providers/Microsoft.Insights/dataCollectionRules/${encodeURIComponent(
    dcrName
  )}`;
  const dcraId = `${clusterId}/providers/Microsoft.Insights/dataCollectionRuleAssociations/ContainerInsightsMetricsExtension`;

  await putAndWait({
    ...baseRequest,
    url: dceUrl,
    apiVersion: DC_API_VERSION,
    body: {
      name: dceName,
      location: macRegion,
      kind: 'Linux',
      properties: {},
    },
  });

  await putAndWait({
    ...baseRequest,
    url: dcrUrl,
    apiVersion: DC_API_VERSION,
    body: {
      location: macRegion,
      kind: 'Linux',
      properties: {
        dataCollectionEndpointId: dceId,
        dataSources: {
          prometheusForwarder: [
            {
              name: 'PrometheusDataSource',
              streams: ['Microsoft-PrometheusMetrics'],
              labelIncludeFilter: {},
            },
          ],
        },
        dataFlows: [
          {
            destinations: ['MonitoringAccount1'],
            streams: ['Microsoft-PrometheusMetrics'],
          },
        ],
        description: 'DCR description',
        destinations: {
          monitoringAccounts: [{ accountResourceId: amwId, name: 'MonitoringAccount1' }],
        },
      },
    },
  });

  await putAndWait({
    ...baseRequest,
    url: dcraId,
    apiVersion: DC_API_VERSION,
    body: {
      location: clusterLocation,
      properties: {
        dataCollectionRuleId: dcrId,
        description:
          'Promtheus data collection association between DCR, DCE and target AKS resource',
      },
    },
  });

  const recommendations = await azListAll<AlertRuleRecommendation>({
    ...baseRequest,
    url: `${amwId}/providers/microsoft.alertsManagement/alertRuleRecommendations`,
    apiVersion: ALERTS_RECOMMENDATIONS_API_VERSION,
  });

  for (const template of recommendations) {
    if (
      template.properties?.alertRuleType?.toLowerCase() !==
        'microsoft.alertsmanagement/prometheusrulegroups' ||
      !template.name
    ) {
      continue;
    }
    const rules = template.properties.rulesArmTemplate?.resources?.[0]?.properties?.rules;
    if (!hasValidPrometheusRules(rules)) continue;

    const ruleGroupName = `${template.name}-${clusterName}`.slice(0, 260);
    const ruleGroupId = `${rgResourcePrefix}/providers/Microsoft.AlertsManagement/prometheusRuleGroups/${ruleGroupName}`;
    const ruleGroupUrl = `${rgPathPrefix}/providers/Microsoft.AlertsManagement/prometheusRuleGroups/${encodeURIComponent(
      ruleGroupName
    )}`;
    const enabled = !template.name.toLowerCase().includes('win');

    await azRequest({
      ...baseRequest,
      url: ruleGroupUrl,
      apiVersion: RULES_API_VERSION,
      method: 'PUT',
      body: {
        id: ruleGroupId,
        name: ruleGroupName,
        type: 'Microsoft.AlertsManagement/prometheusRuleGroups',
        location: macRegion,
        properties: {
          scopes: [amwId, clusterId],
          enabled,
          clusterName,
          interval: 'PT1M',
          rules,
        },
      },
    });
  }
}

const READONLY_CLUSTER_FIELDS = new Set([
  'id',
  'name',
  'type',
  'systemData',
  'eTag',
  'identity.principalId',
  'identity.tenantId',
  'identity.userAssignedIdentities.*.principalId',
  'identity.userAssignedIdentities.*.clientId',
  'properties.provisioningState',
  'properties.powerState',
  'properties.fqdn',
  'properties.privateFQDN',
  'properties.azurePortalFQDN',
  'properties.currentKubernetesVersion',
  'properties.maxAgentPools',
  'properties.resourceUID',
  'properties.agentPoolProfiles.provisioningState',
  'properties.agentPoolProfiles.powerState',
  'properties.agentPoolProfiles.currentOrchestratorVersion',
  'properties.agentPoolProfiles.nodeImageVersion',
  'properties.agentPoolProfiles.eTag',
  'properties.agentPoolProfiles.localDNSProfile.state',
  'properties.addonProfiles.*.identity',
  'properties.podIdentityProfile.userAssignedIdentities.provisioningState',
  'properties.podIdentityProfile.userAssignedIdentities.provisioningInfo',
  'properties.oidcIssuerProfile.issuerURL',
  'properties.networkProfile.loadBalancerProfile.effectiveOutboundIPs',
  'properties.networkProfile.natGatewayProfile.effectiveOutboundIPs',
  'properties.privateLinkResources.privateLinkServiceID',
  'properties.ingressProfile.webAppRouting.identity',
]);

/** Removes read-only fields from the AKS PUT payload. */
function writableClusterValue(value: unknown, path = ''): unknown {
  if (Array.isArray(value)) return value.map(item => writableClusterValue(item, path));
  if (!value || typeof value !== 'object') return value;
  const isResourceMap =
    path === 'identity.userAssignedIdentities' || path === 'properties.addonProfiles';
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const childPath = path ? `${path}.${isResourceMap ? '*' : key}` : key;
      return READONLY_CLUSTER_FIELDS.has(childPath)
        ? []
        : [[key, writableClusterValue(child, childPath)]];
    })
  );
}

function buildClusterPutBody(
  cluster: ManagedClusterResource,
  addons: AddonKey[]
): { body: Record<string, unknown>; alreadySatisfied: boolean } {
  const properties: Record<string, unknown> = { ...(cluster.properties ?? {}) };

  const wantsPrometheus = addons.includes('azure-monitor-metrics');
  const existingMonitor = (properties.azureMonitorProfile ?? {}) as Record<string, unknown>;
  const existingMetrics = (existingMonitor.metrics ?? {}) as Record<string, unknown>;
  const alreadyPrometheusEnabled = existingMetrics.enabled === true;

  if (wantsPrometheus) {
    properties.azureMonitorProfile = {
      ...existingMonitor,
      metrics: {
        ...existingMetrics,
        enabled: true,
        kubeStateMetrics: existingMetrics.kubeStateMetrics ?? {
          metricLabelsAllowlist: '',
          metricAnnotationsAllowList: '',
        },
      },
    };
  }

  const wantsKeda = addons.includes('keda');
  const wantsVpa = addons.includes('vpa');
  const existingAutoScaler = (properties.workloadAutoScalerProfile ?? {}) as Record<
    string,
    unknown
  >;
  const alreadyKedaEnabled =
    (existingAutoScaler.keda as Record<string, unknown> | undefined)?.enabled === true;
  const alreadyVpaEnabled =
    (existingAutoScaler.verticalPodAutoscaler as Record<string, unknown> | undefined)?.enabled ===
    true;
  if (wantsKeda || wantsVpa) {
    properties.workloadAutoScalerProfile = {
      ...existingAutoScaler,
      ...(wantsKeda && {
        keda: {
          ...((existingAutoScaler.keda as Record<string, unknown> | undefined) ?? {}),
          enabled: true,
        },
      }),
      ...(wantsVpa && {
        verticalPodAutoscaler: {
          ...((existingAutoScaler.verticalPodAutoscaler as Record<string, unknown> | undefined) ??
            {}),
          enabled: true,
        },
      }),
    };
  }

  const body = writableClusterValue({ ...cluster, properties }) as Record<string, unknown>;

  return {
    body,
    alreadySatisfied:
      (!wantsPrometheus || alreadyPrometheusEnabled) &&
      (!wantsKeda || alreadyKedaEnabled) &&
      (!wantsVpa || alreadyVpaEnabled),
  };
}

/**
 * Enables one or more cluster addons (`azure-monitor-metrics`, `keda`, `vpa`) via ARM REST.
 * For `azure-monitor-metrics`, registers required providers, creates/reuses the default
 * Azure Monitor Workspace, provisions DCE/DCR/DCRA and Prometheus rule groups, and issues
 * a non-blocking cluster PUT (`2026-01-01`).
 */
export async function enableClusterAddonsViaRest(
  options: EnableClusterAddonOptions
): Promise<{ success: boolean; error?: string }> {
  const { subscriptionId, resourceGroup, clusterName, addon } = options;
  const addons = Array.isArray(addon) ? addon : [addon];

  if (addons.length === 0) {
    return { success: false, error: 'No addons specified' };
  }

  for (const a of addons) {
    if (a !== 'azure-monitor-metrics' && a !== 'keda' && a !== 'vpa') {
      return { success: false, error: `Unknown addon: ${a}` };
    }
  }

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceGroupName(resourceGroup) || !isValidAzResourceName(clusterName)) {
    return { success: false, error: 'Invalid resource group or cluster name format' };
  }

  const linked = createAzureRequestSignal(
    options.signal,
    options.timeoutMs ?? PROVISIONING_TIMEOUT_MS
  );
  try {
    const credential = options.credential ?? getSubscriptionCredential(subscriptionId);
    const cloud =
      !options.credential && (!options.endpoint || !options.scope)
        ? await getAzureCloudEndpoints(undefined, linked.signal)
        : undefined;
    const baseRequest: Omit<AzRequestOptions, 'url'> = {
      ...options,
      endpoint: options.endpoint ?? cloud?.endpoint,
      scope: options.scope ?? cloud?.scope,
      signal: linked.signal,
      credential,
    };

    const clusterUrl =
      `/subscriptions/${encodeURIComponent(subscriptionId)}` +
      `/resourceGroups/${encodeURIComponent(resourceGroup)}` +
      `/providers/Microsoft.ContainerService/managedClusters/${encodeURIComponent(clusterName)}`;

    const readCluster = async (): Promise<ManagedClusterResource> => {
      const response = await azRequestRaw<ManagedClusterResource>({
        ...baseRequest,
        url: clusterUrl,
        apiVersion: AKS_API_VERSION,
      });
      const data = response.data;
      if (!data?.location || !data.properties || typeof data.properties !== 'object') {
        throw new AzureRequestError(
          'Managed AKS cluster response is missing location or properties'
        );
      }
      return { ...data, eTag: response.headers.get('etag') ?? data.eTag };
    };

    let cluster = await readCluster();
    const wantsPrometheus = addons.includes('azure-monitor-metrics');
    const initialMetrics = ((
      cluster.properties?.azureMonitorProfile as Record<string, unknown> | undefined
    )?.metrics ?? {}) as Record<string, unknown>;
    const alreadyPrometheusEnabled = initialMetrics.enabled === true;

    if (wantsPrometheus && !alreadyPrometheusEnabled) {
      await provisionPrometheusArtifacts(
        subscriptionId,
        resourceGroup,
        clusterName,
        cluster.id ?? clusterUrl,
        cluster.location!,
        baseRequest
      );
      cluster = await readCluster();
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const { body, alreadySatisfied } = buildClusterPutBody(cluster, addons);
      if (alreadySatisfied) {
        return { success: true };
      }
      if (!cluster.eTag?.trim()) {
        throw new AzureRequestError(
          'Managed AKS cluster response is missing an ETag for safe update'
        );
      }

      try {
        const response = await azRequestRaw<OperationStatus>({
          ...baseRequest,
          url: clusterUrl,
          apiVersion: AKS_API_VERSION,
          method: 'PUT',
          maxRetries: 0,
          ifMatch: cluster.eTag,
          body,
        });
        const state = response.data?.properties?.provisioningState?.toLowerCase();
        if (state && TERMINAL_FAILURE_STATES.has(state)) {
          throw new AzureRequestError(
            response.data?.properties?.error?.message ??
              `Cluster update ended in ${response.data?.properties?.provisioningState}`,
            { code: response.data?.properties?.error?.code }
          );
        }
        return { success: true };
      } catch (putError) {
        if (attempt === 0 && putError instanceof AzureRequestError && putError.status === 412) {
          cluster = await readCluster();
          continue;
        }
        throw putError;
      }
    }

    return { success: true };
  } catch (error) {
    if (error instanceof AzTokenError && error.needsRelogin) {
      return { success: false, error: 'Authentication required. Please log in to Azure CLI.' };
    }
    return {
      success: false,
      error: `Failed to enable addons (${addons.join(', ')}): ${getErrorMessage(error)}`,
    };
  } finally {
    linked.dispose();
  }
}
