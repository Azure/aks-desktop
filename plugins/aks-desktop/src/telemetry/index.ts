// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { IXHROverride } from '@microsoft/applicationinsights-core-js';
import { ApplicationInsights, type ITelemetryItem } from '@microsoft/applicationinsights-web';
import type { AppInfo } from './appInfo';
import { scrubTelemetryData } from './privacy';
import {
  type AksTier,
  bucketNamespaceCount,
  bucketNodeCount,
  ERROR_AREAS,
  KNOWN_PLUGIN_IDS,
  kubernetesMinor,
  localeLanguage,
  type NamespaceCountBucket,
  type NodeCountBucket,
  sanitizeConsent,
  sanitizeErrorClass,
  sanitizeFeatureType,
  sanitizeKind,
  sanitizeRegion,
  sanitizeRoute,
  sanitizeStatus,
  sanitizeTier,
  TELEMETRY_EVENT_NAMES,
  TELEMETRY_PROPERTY_KEYS,
  type TelemetryConsent,
  type TelemetryErrorArea,
  type TelemetryErrorClass,
  type TelemetryStatus,
} from './schema';

// Module-private SDK handle. Only the typed track* functions below can
// post envelopes.
let ai: ApplicationInsights | null = null;

// True once initTelemetry has run, even if construction failed. Lets us
// skip retries on subsequent renders (e.g. StrictMode double-mount,
// re-mount after a failed connection-string parse).
let initAttempted = false;
let transportOverrideForTests: IXHROverride | null = null;
let telemetryEnabled = false;
let initializedAppVersion: string | null = null;
let consentGeneration = 0;
let consentGateClosed = false;

// Per-resource-id dedupe of headlamp.cluster-shape across re-renders.
// Module-private (the key is never sent).
const emittedShapeFor = new Set<string>();
const errorCounts = new Map<string, number>();

interface PendingEvent {
  name: string;
  properties: Record<string, string>;
}

const pendingEvents: PendingEvent[] = [];
const MAX_PENDING_EVENTS = 100;
const MAX_ERRORS_PER_KEY = 5;

/** Test-only state reset. Do not call from production code. */
export function __resetForTests(): void {
  ai = null;
  initAttempted = false;
  emittedShapeFor.clear();
  errorCounts.clear();
  pendingEvents.length = 0;
  transportOverrideForTests = null;
  telemetryEnabled = false;
  initializedAppVersion = null;
  consentGeneration = 0;
  consentGateClosed = false;
}

/**
 * Clears the initAttempted latch so initTelemetry can run again. Used by
 * the grant side of a consent transition, which needs a fresh init
 * attempt after a prior disable.
 *
 * Unloads any SDK still loaded first. The usual grant path runs after a
 * revoke has already unloaded, so `ai` is null — but a grant that arrives
 * while a revoke's flush is still pending finds the previous instance
 * alive, and initTelemetry assigns `ai = insights` without unloading a
 * prior one (line 158). Without this, that instance is orphaned along
 * with its send queue: unreachable, never flushed, never unloaded.
 */
export function resetInitAttempted(): void {
  if (ai) {
    disableAndUnload(ai);
    ai = null;
  }
  initAttempted = false;
}

export function setTelemetryEnabled(enabled: boolean): void {
  telemetryEnabled = enabled;
  if (enabled) return;

  pendingEvents.length = 0;
  if (ai) {
    disableAndUnload(ai);
    ai = null;
  }
}

/**
 * Starts a new consent transition: closes the ordinary-event gate before
 * anything is emitted, and returns a generation number the caller must
 * pass to endConsentTransition. A stale generation (superseded by a
 * later beginConsentTransition) is a no-op on end, so a slow revoke that
 * resumes after a fresh grant cannot reopen a state it no longer owns.
 */
export function beginConsentTransition(): number {
  consentGateClosed = true;
  consentGeneration += 1;
  return consentGeneration;
}

export function isCurrentConsentGeneration(gen: number): boolean {
  return gen === consentGeneration;
}

/** Reopens the ordinary-event gate only if gen is still the current transition. */
export function endConsentTransition(gen: number): void {
  if (!isCurrentConsentGeneration(gen)) return;
  consentGateClosed = false;
}

export function __setTransportOverrideForTests(transport: IXHROverride): void {
  transportOverrideForTests = transport;
}

export function __getPendingEventCountForTests(): number {
  return pendingEvents.length;
}

/**
 * Flushes any buffered envelopes, bounded by timeoutMs. Always resolves —
 * on flush completion, on timeout, on a throwing transport, or
 * immediately when ai is null. Never rejects: a hung or offline
 * transport must not leave a consent transition pending indefinitely.
 */
export function flushTelemetry(timeoutMs = 2000): Promise<void> {
  return new Promise(resolve => {
    if (!ai) {
      resolve();
      return;
    }
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(settle, timeoutMs);
    try {
      void ai.flush(false, settle);
    } catch {
      // Fail closed. A throwing transport still resolves the flush.
      settle();
    }
  });
}

export function __flushForTests(): Promise<void> {
  return flushTelemetry();
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
 * Initialize App Insights and flush events captured by the early Redux callback. Idempotent:
 * the initAttempted flag survives React StrictMode double-mount.
 *
 * Fails closed — if the AI constructor throws, ai stays null and
 * initAttempted stays true so we don't retry on every render.
 */
export function initTelemetry(opts: InitTelemetryOptions): void {
  if (!telemetryEnabled) {
    pendingEvents.length = 0;
    return;
  }
  if (initAttempted) return;
  initAttempted = true;

  let insights: ApplicationInsights | null = null;
  try {
    const config = {
      connectionString: opts.connectionString,
      disableFetchTracking: true,
      disableAjaxTracking: true,
      disableExceptionTracking: true,
      disableCookiesUsage: true,
      isStorageUseDisabled: true,
      enableAutoRouteTracking: false,
    };
    if (transportOverrideForTests) {
      Object.assign(config, {
        httpXHROverride: transportOverrideForTests,
        alwaysUseXhrOverride: true,
      });
    }
    insights = new ApplicationInsights({
      config,
    });

    // Stamp ai.user.id with the install UUID so the Azure Portal Users
    // metric correlates by install rather than by SDK session. The id
    // lives only as an envelope tag — never as a regular property
    // dimension (it would otherwise be queryable/exportable as data).
    configureTelemetryPrivacy(insights, opts.installId);
    insights.loadAppInsights();
    ai = insights;
    initializedAppVersion = opts.sessionProps.appVersion;
  } catch {
    if (insights) disableAndUnload(insights);
    ai = null;
    pendingEvents.length = 0;
    return;
  }

  trackSessionStart(opts.sessionProps);
  flushPendingEvents();
}

function disableAndUnload(insights: ApplicationInsights): void {
  try {
    insights.config.disableTelemetry = true;
  } catch {
    // Continue to unload even when the dynamic config cannot be updated.
  }
  try {
    void insights.unload(false);
  } catch {
    // Fail closed. Telemetry cleanup failures are never reported recursively.
  }
}

export function isTelemetryInitialized(): boolean {
  return initAttempted;
}

export function createTelemetryInitializer(
  installId: string
): (envelope: ITelemetryItem) => boolean | void {
  return envelope => {
    try {
      const tags = envelope.tags ?? {};
      const trace = (envelope.ext?.trace ?? {}) as Record<string, unknown>;
      const taggedOperationName = getEnvelopeTag(tags, 'ai.operation.name');
      const operationName =
        typeof trace.name === 'string'
          ? trace.name
          : typeof taggedOperationName === 'string'
          ? taggedOperationName
          : globalThis.location?.pathname;
      trace.name = sanitizeRoute(operationName);
      envelope.ext = envelope.ext ?? {};
      envelope.ext.trace = trace;
      setEnvelopeTag(tags, 'ai.user.id', installId);
      setEnvelopeTag(tags, 'ai.operation.name', trace.name);
      setEnvelopeTag(tags, 'ai.location.ip', '0.0.0.0');
      envelope.tags = tags;

      const scrubbed = scrubTelemetryData(envelope) as ITelemetryItem;
      for (const key of Object.keys(envelope)) {
        delete (envelope as unknown as Record<string, unknown>)[key];
      }
      Object.assign(envelope, scrubbed);
    } catch {
      return false;
    }
  };
}

function getEnvelopeTag(tags: ITelemetryItem['tags'], key: string): unknown {
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (tag && key in tag) return tag[key];
    }
    return undefined;
  }
  return tags?.[key];
}

function setEnvelopeTag(
  tags: NonNullable<ITelemetryItem['tags']>,
  key: string,
  value: unknown
): void {
  if (Array.isArray(tags)) {
    const existing = tags.find(tag => tag && key in tag);
    if (existing) existing[key] = value;
    else tags.push({ [key]: value });
    return;
  }
  tags[key] = value;
}

export function configureTelemetryPrivacy(insights: ApplicationInsights, installId: string): void {
  insights.addTelemetryInitializer(createTelemetryInitializer(installId));
}

function send(event: PendingEvent): void {
  if (!ai) return;
  try {
    ai.trackEvent(
      initializedAppVersion
        ? {
            ...event,
            properties: { ...event.properties, appVersion: initializedAppVersion },
          }
        : event
    );
  } catch {
    // Fail closed. Telemetry failures never emit more telemetry or logs.
  }
}

function flushPendingEvents(): void {
  if (!ai) return;
  const events = pendingEvents.splice(0);
  for (const event of events) send(event);
}

function emitInternal(name: string, properties: Record<string, string | undefined>): void {
  if (!telemetryEnabled) return;
  if (!TELEMETRY_EVENT_NAMES.has(name)) return;
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined && TELEMETRY_PROPERTY_KEYS.has(key)) filtered[key] = value;
  }
  const event = { name, properties: filtered };
  if (!ai) {
    if (!initAttempted && pendingEvents.length < MAX_PENDING_EVENTS) pendingEvents.push(event);
    return;
  }
  send(event);
}

/** The only path from the typed wrappers to ai.trackEvent for ordinary events. */
function emit(name: string, properties: Record<string, string | undefined>): void {
  if (consentGateClosed) return;
  emitInternal(name, properties);
}

/**
 * Emits the consent transition event itself. Bypasses the ordinary-event
 * gate — this is the one event a revoke must still deliver — but still
 * respects the telemetryEnabled flag and the closed consent vocabulary.
 */
export function emitConsentEvent(consent: TelemetryConsent): void {
  if (!telemetryEnabled) return;
  const safeConsent = sanitizeConsent(consent);
  if (safeConsent === undefined) return;
  emitInternal('headlamp.telemetry-consent', { consent: safeConsent });
}

/**
 * Bypasses the ordinary-event gate. Its one production call site is
 * initTelemetry, which runs inside a consent transition (the grant side
 * closes the gate before re-initializing) and is already gated on
 * telemetryEnabled above. Routing this through `emit` instead would drop
 * session-start on every mid-session grant, since the gate does not reopen
 * until after initTelemetry returns. Do not "fix" this back to `emit`.
 */
export function trackSessionStart(p: SessionStartProps): void {
  emitInternal('headlamp.session-start', {
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
  // Bail before touching the dedupe set when telemetry isn't initialized,
  // or when the consent gate is closed: otherwise a pre-init or
  // mid-transition call would mark the key as seen and permanently
  // suppress the post-init/post-transition emission for the same cluster.
  if (!ai || consentGateClosed || emittedShapeFor.has(dedupeKey)) return;
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

export interface ErrorProps {
  area: TelemetryErrorArea;
  errorClass: TelemetryErrorClass;
  phase?: TelemetryErrorPhase;
}

export type TelemetryErrorPhase = TelemetryStatus;

export function trackError(p: ErrorProps): void {
  if (!telemetryEnabled) return;
  // Bail before touching errorCounts while the consent gate is closed:
  // otherwise a mid-transition error charges the per-key session quota for an
  // envelope `emit` then drops, and once five are charged, real errors on that
  // key stay suppressed for the rest of the session. Same reasoning as
  // trackClusterShape's dedupe-set guard below. Deliberately no `!ai` check —
  // pre-init errors are meant to buffer into pendingEvents and flush on init.
  if (consentGateClosed) return;
  if (!ERROR_AREAS.has(p.area)) return;
  const errorClass = sanitizeErrorClass(p.errorClass);
  const key = `${p.area}:${errorClass}`;
  const count = errorCounts.get(key) ?? 0;
  if (count >= MAX_ERRORS_PER_KEY) return;
  errorCounts.set(key, count + 1);
  emit('headlamp.exception', {
    area: p.area,
    errorClass,
    phase: p.phase === undefined ? undefined : sanitizeStatus(p.phase),
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
