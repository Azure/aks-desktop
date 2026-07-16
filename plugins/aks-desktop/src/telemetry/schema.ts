// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Sanitizers and closed vocabularies for telemetry envelope properties. */

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

export const KNOWN_PLUGIN_IDS: ReadonlySet<string> = new Set(['aks-desktop']);

export const TELEMETRY_EVENT_NAMES: ReadonlySet<string> = new Set([
  'headlamp.session-start',
  'headlamp.cluster-shape',
  'headlamp.feature',
  'headlamp.exception',
  'headlamp.plugins-loaded',
]);

export const TELEMETRY_PROPERTY_KEYS: ReadonlySet<string> = new Set([
  'appVersion',
  'locale',
  'os',
  'arch',
  'electronVersion',
  'headlampVersion',
  'provider',
  'kubernetesMinor',
  'nodeCountBucket',
  'namespaceCountBucket',
  'region',
  'aksTier',
  'feature',
  'status',
  'resourceKind',
  'errorClass',
  'area',
  'phase',
  'totalCount',
  'enabledCount',
  'knownEnabledIds',
  'thirdPartyCount',
]);

/** Redux event types forwarded as `headlamp.feature` envelopes. */
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
  'aksd.azure-login',
  'aksd.azure-logout',
  'aksd.project-create',
  'aksd.project-import',
  'aksd.namespace-create',
  'aksd.metrics',
  'aksd.scaling',
  'aksd.deploy',
  'aksd.pipeline',
  // PLUGINS_LOADED routes to trackPluginsLoaded; ERROR_BOUNDARY is captured
  // by TelemetryErrorBoundary directly. Both intentionally omitted.
]);

const EVENT_STATUS_VALUES = [
  'unknown',
  'open',
  'closed',
  'confirmed',
  'finished',
  'opened',
  'started',
  'succeeded',
  'failed',
  'cancelled',
  'completed',
  'viewed',
] as const;

export type TelemetryStatus = (typeof EVENT_STATUS_VALUES)[number];
export const EVENT_STATUSES: ReadonlySet<TelemetryStatus> = new Set(EVENT_STATUS_VALUES);

export const KNOWN_ROUTES: ReadonlySet<string> = new Set([
  '/index',
  '/login',
  '/profile',
  '/projects',
  '/project-create',
  '/project-import',
  '/namespace-create',
  '/add-cluster',
  '/settings',
  'unknown',
]);

const ERROR_CLASS_VALUES = [
  'AuthenticationError',
  'PermissionError',
  'NetworkError',
  'ValidationError',
  'TimeoutError',
  'UnknownError',
] as const;

export type TelemetryErrorClass = (typeof ERROR_CLASS_VALUES)[number];
export const ERROR_CLASSES: ReadonlySet<TelemetryErrorClass> = new Set(ERROR_CLASS_VALUES);

const ERROR_AREA_VALUES = [
  'azure-login',
  'project-create',
  'project-import',
  'namespace-create',
  'metrics',
  'deploy',
  'scaling',
  'pipeline',
  'kubernetes',
  'plugin-ui',
] as const;

export type TelemetryErrorArea = (typeof ERROR_AREA_VALUES)[number];
export const ERROR_AREAS: ReadonlySet<TelemetryErrorArea> = new Set(ERROR_AREA_VALUES);

/**
 * Azure region shape: lowercase letters containing a compass keyword and
 * an optional 1-2 digit suffix. The `region` value flows from ARM, not
 * user input, so a shape check is sufficient and immune to rot when
 * Azure adds new regions.
 */
export const AZURE_REGION_RE = /^[a-z]*(central|north|south|east|west)[a-z]*\d{0,2}$/i;

export function sanitizeKind(kind: string | undefined): string {
  if (!kind) return 'Unknown';
  // 'Multiple' is the fixed-vocabulary bucket sentinel returned by
  // extractKindFromPayload for heterogeneous plural-resource events
  // (delete-resources / restart-resources). Pass through verbatim so
  // re-sanitization downstream doesn't clamp it to 'CustomResource'.
  if (kind === 'Multiple') return 'Multiple';
  return BUILTIN_K8S_KINDS.has(kind) ? kind : 'CustomResource';
}

export function sanitizeRegion(region: string | null | undefined): string {
  if (!region) return 'Other';
  return AZURE_REGION_RE.test(region) ? region.toLowerCase() : 'Other';
}

export function sanitizeFeatureType(type: string | undefined): string | undefined {
  return type && KNOWN_FEATURE_TYPES.has(type) ? type : undefined;
}

export function sanitizeStatus(status: string | null | undefined): TelemetryStatus {
  if (!status) return 'unknown';
  return EVENT_STATUSES.has(status as TelemetryStatus) ? (status as TelemetryStatus) : 'unknown';
}

export function sanitizeRoute(route: string | null | undefined): string {
  if (!route || !route.startsWith('/')) return 'unknown';
  const path = route.split(/[?#]/, 1)[0];

  if (path === '/' || path === '/index') return '/index';
  if (path === '/azure/login') return '/login';
  if (path === '/azure/profile') return '/profile';
  if (path === '/projects') return '/projects';
  if (path === '/projects/create-aks-project') return '/project-create';
  if (path === '/projects/import-aks-projects') return '/project-import';
  if (path === '/projects/create-namespace') return '/namespace-create';
  if (path === '/add-cluster-aks') return '/add-cluster';
  if (path === '/settings' || path.startsWith('/settings/')) return '/settings';
  return 'unknown';
}

export function sanitizeErrorClass(errorClass: string | null | undefined): TelemetryErrorClass {
  return errorClass && ERROR_CLASSES.has(errorClass as TelemetryErrorClass)
    ? (errorClass as TelemetryErrorClass)
    : 'UnknownError';
}

export type AksTier = 'Free' | 'Standard' | 'Premium' | 'Unknown';
const VALID_AKS_TIERS: ReadonlySet<string> = new Set(['Free', 'Standard', 'Premium']);

export function sanitizeTier(tier: string | null | undefined): AksTier {
  return tier && VALID_AKS_TIERS.has(tier) ? (tier as AksTier) : 'Unknown';
}

export type NodeCountBucket = '0' | '1-5' | '6-20' | '21-100' | '100+';
export function bucketNodeCount(n: number): NodeCountBucket {
  if (n <= 0) return '0';
  if (n <= 5) return '1-5';
  if (n <= 20) return '6-20';
  if (n <= 100) return '21-100';
  return '100+';
}

export type NamespaceCountBucket = '0' | '1-10' | '11-50' | '51-200' | '200+';
export function bucketNamespaceCount(n: number): NamespaceCountBucket {
  if (n <= 0) return '0';
  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  return '200+';
}

export function kubernetesMinor(version: string): string {
  const m = /^v?(\d+)\.(\d+)/.exec(version);
  return m ? `${m[1]}.${m[2]}` : 'unknown';
}

export function localeLanguage(locale: string): string {
  if (!locale) return 'unknown';
  return locale.split(/[-_]/)[0].toLowerCase();
}
