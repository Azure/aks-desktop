// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Vocabularies and sanitizers gating every value before it reaches a
 * telemetry envelope. No runtime side effects.
 */

export const BUILTIN_K8S_KINDS: ReadonlySet<string> = new Set([
  // Core
  'Pod',
  'Service',
  'Namespace',
  'Node',
  'ConfigMap',
  'Secret',
  'PersistentVolume',
  'PersistentVolumeClaim',
  'ServiceAccount',
  'Endpoints',
  'EndpointSlice',
  'Event',
  'LimitRange',
  'ResourceQuota',
  // Apps
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'ReplicationController',
  // Batch
  'Job',
  'CronJob',
  // Networking
  'Ingress',
  'IngressClass',
  'NetworkPolicy',
  'Gateway',
  'HTTPRoute',
  'GRPCRoute',
  // Storage
  'StorageClass',
  'VolumeAttachment',
  'CSIDriver',
  'CSINode',
  // RBAC
  'Role',
  'RoleBinding',
  'ClusterRole',
  'ClusterRoleBinding',
  // Autoscaling
  'HorizontalPodAutoscaler',
  'VerticalPodAutoscaler',
  'PodDisruptionBudget',
  // Admission
  'MutatingWebhookConfiguration',
  'ValidatingWebhookConfiguration',
  // API
  'CustomResourceDefinition',
  'APIService',
  // Lease
  'Lease',
]);

export const KNOWN_ERROR_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'URIError',
  'EvalError',
  'KubeApiError',
  'ApiError',
  'NetworkError',
  'AbortError',
  'TimeoutError',
]);

export const KNOWN_PLUGIN_IDS: ReadonlySet<string> = new Set(['aks-desktop']);

/**
 * Azure public cloud regions (Microsoft-defined vocabulary, not customer
 * data). Sourced from `az account list-locations` for public cloud only;
 * sovereign clouds are intentionally excluded.
 */
export const AZURE_REGIONS: ReadonlySet<string> = new Set([
  'eastus',
  'eastus2',
  'southcentralus',
  'westus',
  'westus2',
  'westus3',
  'centralus',
  'northcentralus',
  'westcentralus',
  'canadacentral',
  'canadaeast',
  'brazilsouth',
  'brazilsoutheast',
  'northeurope',
  'westeurope',
  'uksouth',
  'ukwest',
  'francecentral',
  'francesouth',
  'germanywestcentral',
  'germanynorth',
  'norwayeast',
  'norwaywest',
  'switzerlandnorth',
  'switzerlandwest',
  'swedencentral',
  'swedensouth',
  'polandcentral',
  'italynorth',
  'spaincentral',
  'uaenorth',
  'uaecentral',
  'southafricanorth',
  'southafricawest',
  'australiaeast',
  'australiasoutheast',
  'australiacentral',
  'australiacentral2',
  'eastasia',
  'southeastasia',
  'japaneast',
  'japanwest',
  'koreacentral',
  'koreasouth',
  'centralindia',
  'southindia',
  'westindia',
  'jioindiawest',
  'jioindiacentral',
  'qatarcentral',
  'israelcentral',
  'mexicocentral',
]);

/**
 * Event names allowed to leave the renderer. The privacy initializer
 * replaces the envelope `name` field with `'unknown'` for anything not in
 * this set, so a caller that bypasses the typed helpers (e.g. by calling
 * `window.appInsights.trackEvent` directly) cannot smuggle data through
 * the event name itself.
 */
export const KNOWN_EVENT_NAMES: ReadonlySet<string> = new Set([
  'headlamp.session-start',
  'headlamp.cluster-shape',
  'headlamp.feature',
  'headlamp.exception',
  'headlamp.plugins-loaded',
  // ErrorBoundary in the fork still calls trackEvent('exception', ...);
  // allowlist its bare name so the existing path keeps working.
  'exception',
]);

/**
 * The set of HeadlampEventType string values that we forward into the
 * `feature` property of `headlamp.feature` envelopes. We allowlist this
 * (rather than passing `event.type` through) so a future upstream change
 * that encodes data in an event type string (e.g. `cluster:my-prod`)
 * cannot leak through the `feature` property.
 *
 * Includes the string literal `'headlamp.rollback-resource'` because
 * the corresponding `HeadlampEventType.ROLLBACK_RESOURCE` is missing
 * from the installed `@kinvolk/headlamp-plugin` typedef even though the
 * fork dispatches it at runtime.
 */
export const KNOWN_FEATURE_TYPES: ReadonlySet<string> = new Set([
  'headlamp.delete-resource',
  'headlamp.delete-resources',
  'headlamp.create-resource',
  'headlamp.edit-resource',
  'headlamp.scale-resource',
  'headlamp.restart-resource',
  'headlamp.restart-resources',
  'headlamp.rollback-resource',
  'headlamp.logs',
  'headlamp.terminal',
  'headlamp.pod-attach',
  'headlamp.plugin-loading-error',
  'headlamp.details-view',
  'headlamp.list-view',
  'headlamp.object-events',
  // PLUGINS_LOADED and ERROR_BOUNDARY are intentionally omitted:
  // PLUGINS_LOADED routes to trackPluginsLoaded (not a feature event);
  // ERROR_BOUNDARY is handled by the fork's existing trackEvent('exception',…)
  // path.
]);

/**
 * Sanitize an arbitrary feature-name string against KNOWN_FEATURE_TYPES.
 * Returns the input verbatim if allowlisted, else `undefined` so the
 * caller can decide whether to drop the event entirely.
 */
export function sanitizeFeatureType(type: string | undefined): string | undefined {
  return type && KNOWN_FEATURE_TYPES.has(type) ? type : undefined;
}

export const KNOWN_PROPERTY_KEYS: ReadonlySet<string> = new Set([
  // session-start
  'installId',
  'appVersion',
  'headlampVersion',
  'electronVersion',
  'os',
  'osMajor',
  'arch',
  'locale',
  // cluster-shape
  'provider',
  'kubernetesMinor',
  'nodeCountBucket',
  'namespaceCountBucket',
  'region',
  'aksTier',
  // feature
  'feature',
  'status',
  'resourceKind',
  // exception
  'errorName',
  // plugins-loaded
  'totalCount',
  'enabledCount',
  'knownEnabledIds',
  'thirdPartyCount',
]);

export function sanitizeKind(kind: string | undefined): string {
  if (!kind) return 'Unknown';
  return BUILTIN_K8S_KINDS.has(kind) ? kind : 'CustomResource';
}

export function sanitizeErrorName(name: string | undefined): string {
  if (!name) return 'Other';
  return KNOWN_ERROR_NAMES.has(name) ? name : 'Other';
}

export function sanitizeRegion(region: string | undefined): string {
  if (!region) return 'Other';
  return AZURE_REGIONS.has(region) ? region : 'Other';
}

export type NodeCountBucket = '1-5' | '6-20' | '21-100' | '100+';
export function bucketNodeCount(n: number): NodeCountBucket {
  if (n <= 5) return '1-5';
  if (n <= 20) return '6-20';
  if (n <= 100) return '21-100';
  return '100+';
}

export type NamespaceCountBucket = '1-10' | '11-50' | '51-200' | '200+';
export function bucketNamespaceCount(n: number): NamespaceCountBucket {
  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  return '200+';
}

export function kubernetesMinor(version: string): string {
  // Accepts "v1.29.4", "1.29.4", "v1.28", etc. Returns "1.29".
  const m = /^v?(\d+)\.(\d+)/.exec(version);
  return m ? `${m[1]}.${m[2]}` : 'unknown';
}

export function localeLanguage(locale: string): string {
  if (!locale) return 'unknown';
  return locale.split(/[-_]/)[0].toLowerCase();
}

export function osMajor(release: string): string {
  const m = /^(\d+)/.exec(release);
  return m ? m[1] : 'unknown';
}
