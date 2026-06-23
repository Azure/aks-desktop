// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ApplicationInsights, type ITelemetryItem } from '@microsoft/applicationinsights-web';
import type { AppInfo } from './appInfo';
import {
  type AksTier,
  bucketNamespaceCount,
  bucketNodeCount,
  KNOWN_PLUGIN_IDS,
  kubernetesMinor,
  localeLanguage,
  type NamespaceCountBucket,
  type NodeCountBucket,
  sanitizeFeatureType,
  sanitizeKind,
  sanitizeRegion,
  sanitizeStatus,
  sanitizeTier,
} from './schema';
import { registerReduxCallback } from './setup';

// Module-private SDK handle. Only the typed track* functions below can
// post envelopes.
let ai: ApplicationInsights | null = null;

// True once initTelemetry has run, even if construction failed. Lets us
// skip retries on subsequent renders (e.g. StrictMode double-mount,
// re-mount after a failed connection-string parse).
let initAttempted = false;

// Per-resource-id dedupe of headlamp.cluster-shape across re-renders.
// Module-private (the key is never sent).
const emittedShapeFor = new Set<string>();

/** Test-only state reset. Do not call from production code. */
export function __resetForTests(): void {
  ai = null;
  initAttempted = false;
  emittedShapeFor.clear();
}

export interface SessionStartProps extends AppInfo {
  appVersion: string;
  /** Headlamp base version (REACT_APP_HEADLAMP_VERSION). */
  headlampVersion: string;
  locale: string;
}

export interface InitTelemetryOptions {
  connectionString: string;
  installId: string;
  sessionProps: SessionStartProps;
}

/**
 * Initialize App Insights and wire the redux event callback. Idempotent:
 * the initAttempted flag survives React StrictMode double-mount.
 *
 * Fails closed — if the AI constructor throws, ai stays null and
 * initAttempted stays true so we don't retry on every render.
 */
export function initTelemetry(opts: InitTelemetryOptions): void {
  if (initAttempted) return;
  initAttempted = true;

  try {
    ai = new ApplicationInsights({
      config: {
        connectionString: opts.connectionString,
        disableFetchTracking: true,
        disableAjaxTracking: true,
        disableExceptionTracking: true,
        disableCookiesUsage: true,
        isStorageUseDisabled: true,
        enableAutoRouteTracking: false,
      },
    });
    ai.loadAppInsights();

    // Stamp ai.user.id with the install UUID so the Azure Portal Users
    // metric correlates by install rather than by SDK session. The id
    // lives only as an envelope tag — never as a regular property
    // dimension (it would otherwise be queryable/exportable as data).
    const { installId } = opts;
    ai.addTelemetryInitializer((envelope: ITelemetryItem) => {
      envelope.tags = envelope.tags ?? {};
      envelope.tags['ai.user.id'] = installId;
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[aksd-telemetry] init failed:', e);
    ai = null;
    return;
  }

  trackSessionStart(opts.sessionProps);
  registerReduxCallback();
}

export function isTelemetryInitialized(): boolean {
  return initAttempted;
}

/** The only path from the typed wrappers to ai.trackEvent. */
function emit(name: string, properties: Record<string, string | undefined>): void {
  if (!ai) return;
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) filtered[key] = value;
  }
  try {
    ai.trackEvent({ name, properties: filtered });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[aksd-telemetry] track failed:', name, e);
  }
}

export function trackSessionStart(p: SessionStartProps): void {
  emit('headlamp.session-start', {
    appVersion: p.appVersion,
    locale: localeLanguage(p.locale),
    os: p.os,
    arch: p.arch,
    electronVersion: p.electronVersion,
    headlampVersion: p.headlampVersion,
  });
}

export interface ClusterShapeInput {
  kubernetesVersion: string | null | undefined;
  nodeCount: number | null | undefined;
  namespaceCount: number | null | undefined;
  region: string | null | undefined;
  aksTier: string | null | undefined;
}

/**
 * Emits one `headlamp.cluster-shape` per dedupeKey. No-ops when any
 * field is null/undefined/empty or when dedupeKey was already seen --
 * never mix Unknown with real values, never re-emit for the same
 * cluster across re-renders.
 */
export function trackClusterShape(dedupeKey: string, input: ClusterShapeInput): void {
  // Bail before touching the dedupe set when telemetry isn't initialized:
  // otherwise a pre-init call would mark the key as seen and permanently
  // suppress the post-init emission for the same cluster.
  if (!ai || emittedShapeFor.has(dedupeKey)) return;
  const {
    kubernetesVersion: kv,
    nodeCount: nc,
    namespaceCount: nsc,
    region: r,
    aksTier: t,
  } = input;
  if (!kv || nc === null || nc === undefined || nsc === null || nsc === undefined || !r || !t) {
    return;
  }
  emittedShapeFor.add(dedupeKey);
  emit('headlamp.cluster-shape', {
    provider: 'AKS',
    kubernetesMinor: kubernetesMinor(kv),
    nodeCountBucket: bucketNodeCount(nc) satisfies NodeCountBucket,
    namespaceCountBucket: bucketNamespaceCount(nsc) satisfies NamespaceCountBucket,
    region: sanitizeRegion(r),
    aksTier: sanitizeTier(t) satisfies AksTier,
  });
}

export interface FeatureProps {
  feature: string;
  status: string;
  resourceKind?: string;
}

export function trackFeature(p: FeatureProps): void {
  const safeFeature = sanitizeFeatureType(p.feature);
  if (safeFeature === undefined) return;
  emit('headlamp.feature', {
    feature: safeFeature,
    status: sanitizeStatus(p.status),
    resourceKind: p.resourceKind === undefined ? undefined : sanitizeKind(p.resourceKind),
  });
}

export function trackException(errorName: string): void {
  emit('headlamp.exception', { errorName: errorName || 'Unknown' });
}

export interface PluginsLoadedProps {
  totalCount: number;
  enabledCount: number;
  knownEnabledIds: string[];
  thirdPartyCount: number;
}

export function trackPluginsLoaded(p: PluginsLoadedProps): void {
  const knownOnly = p.knownEnabledIds.filter(id => KNOWN_PLUGIN_IDS.has(id));
  emit('headlamp.plugins-loaded', {
    totalCount: String(p.totalCount),
    enabledCount: String(p.enabledCount),
    knownEnabledIds: knownOnly.join(','),
    thirdPartyCount: String(p.thirdPartyCount),
  });
}
