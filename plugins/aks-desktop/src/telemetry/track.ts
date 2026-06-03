// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { ApplicationInsights } from '@microsoft/applicationinsights-web';
import {
  KNOWN_PLUGIN_IDS,
  KNOWN_PROPERTY_KEYS,
  localeLanguage,
  osMajor as sanitizeOsMajor,
  sanitizeErrorName,
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

export interface SessionStartProps {
  installId: string;
  appVersion: string;
  headlampVersion: string;
  electronVersion: string;
  os: 'win32' | 'darwin' | 'linux';
  osMajor: string;
  arch: 'x64' | 'arm64' | 'ia32';
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
  nodeCountBucket: '1-5' | '6-20' | '21-100' | '100+';
  namespaceCountBucket: '1-10' | '11-50' | '51-200' | '200+';
  region: string;
  aksTier: 'Free' | 'Standard' | 'Premium' | 'Unknown';
}

export function trackClusterShape(p: ClusterShapeProps): void {
  // Region/kubernetesMinor were sanitized at the call site (the only place
  // that has the raw values). We still pass them through KNOWN_PROPERTY_KEYS
  // filter via emit().
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
  emit('headlamp.feature', {
    feature: p.feature,
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
  // Filter knownEnabledIds against the allowlist defensively, even though
  // the caller is supposed to do it already.
  const knownOnly = p.knownEnabledIds.filter(id => KNOWN_PLUGIN_IDS.has(id));
  emit('headlamp.plugins-loaded', {
    totalCount: String(p.totalCount),
    enabledCount: String(p.enabledCount),
    knownEnabledIds: knownOnly.join(','),
    thirdPartyCount: String(p.thirdPartyCount),
  });
}
