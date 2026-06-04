// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { ApplicationInsights } from '@microsoft/applicationinsights-web';
import type { AppInfo } from './appInfo';
import {
  KNOWN_PLUGIN_IDS,
  KNOWN_PROPERTY_KEYS,
  localeLanguage,
  type NamespaceCountBucket,
  type NodeCountBucket,
  osMajor as sanitizeOsMajor,
  sanitizeErrorName,
  sanitizeFeatureType,
  sanitizeKind,
} from './schema';

declare global {
  interface Window {
    appInsights: ApplicationInsights | undefined;
  }
}

/**
 * Forward an event to App Insights, dropping any property whose key isn't
 * in `KNOWN_PROPERTY_KEYS` (defense in depth — the call sites should
 * already be schema-conformant; this is the last line before send).
 */
function emit(name: string, properties: Record<string, string | undefined>): void {
  const ai = window.appInsights;
  if (!ai) return;
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue;
    if (!KNOWN_PROPERTY_KEYS.has(key)) continue;
    filtered[key] = value;
  }
  try {
    ai.trackEvent({ name, properties: filtered });
  } catch (e) {
    // Never let telemetry failures break the app.
    // eslint-disable-next-line no-console
    console.error('Failed to track event', e);
  }
}

export interface SessionStartProps extends AppInfo {
  installId: string;
  appVersion: string;
  headlampVersion: string;
  locale: string;
}

export function trackSessionStart(p: SessionStartProps): void {
  emit('headlamp.session-start', {
    installId: p.installId,
    appVersion: p.appVersion,
    headlampVersion: p.headlampVersion,
    electronVersion: p.electronVersion,
    os: p.os,
    osMajor: sanitizeOsMajor(p.osMajor),
    arch: p.arch,
    locale: localeLanguage(p.locale),
  });
}

export interface ClusterShapeProps {
  provider: 'AKS';
  kubernetesMinor: string;
  nodeCountBucket: NodeCountBucket;
  namespaceCountBucket: NamespaceCountBucket;
  region: string;
  aksTier: 'Free' | 'Standard' | 'Premium' | 'Unknown';
}

export function trackClusterShape(p: ClusterShapeProps): void {
  emit('headlamp.cluster-shape', {
    provider: p.provider,
    kubernetesMinor: p.kubernetesMinor,
    nodeCountBucket: p.nodeCountBucket,
    namespaceCountBucket: p.namespaceCountBucket,
    region: p.region,
    aksTier: p.aksTier,
  });
}

export interface FeatureProps {
  feature: string;
  status: string;
  resourceKind?: string;
}

export function trackFeature(p: FeatureProps): void {
  // Drop events whose `feature` string isn't in our allowlist. Prevents a
  // future upstream change that encodes data in an event type (e.g.
  // `cluster:my-prod`) from leaking that string through the `feature`
  // property even if the envelope name is rewritten to `unknown`.
  const safeFeature = sanitizeFeatureType(p.feature);
  if (safeFeature === undefined) return;
  emit('headlamp.feature', {
    feature: safeFeature,
    status: p.status,
    resourceKind: p.resourceKind === undefined ? undefined : sanitizeKind(p.resourceKind),
  });
}

export interface ExceptionProps {
  errorName: string;
}

export function trackException(p: ExceptionProps): void {
  emit('headlamp.exception', {
    errorName: sanitizeErrorName(p.errorName),
  });
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
