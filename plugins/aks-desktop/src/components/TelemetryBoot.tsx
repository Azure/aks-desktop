// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useRef } from 'react';
import { initTelemetry, setTelemetryEnabled } from '../telemetry';
import { getAppInfo } from '../telemetry/appInfo';
import { grantConsent, revokeConsent } from '../telemetry/consent';
import { getOrCreateInstallId } from '../telemetry/installId';
import {
  isTelemetryEnabled,
  TELEMETRY_DEFAULTS,
  type TelemetryConfig,
  telemetrySettingsStore,
} from './PluginSettings/telemetrySettingsStore';

/**
 * Production App Insights connection string for AKS Desktop. Connection
 * strings are addresses (not credentials), so it's safe to ship in the
 * bundle. Override at build time by exporting
 * REACT_APP_APPINSIGHTS_CONNECTION_STRING — headlamp-plugin's Vite
 * config substitutes that env var into `import.meta.env` at bundle time
 * and the override wins below.
 */
const DEFAULT_CONNECTION_STRING =
  'InstrumentationKey=5f8e9ae9-1e90-4ab7-8aeb-429b5a3bf73b;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;ApplicationId=e50d3436-371c-4165-bd66-c17b1f551dfe';

const CONNECTION_STRING =
  (import.meta.env.REACT_APP_APPINSIGHTS_CONNECTION_STRING as string | undefined) ||
  DEFAULT_CONNECTION_STRING;

const HEADLAMP_VERSION =
  (import.meta.env.REACT_APP_HEADLAMP_VERSION as string | undefined) ?? 'unknown';

interface DesktopAppConfigApi {
  receive: (
    channel: 'appConfig',
    callback: (config: { appVersion?: string }) => void
  ) => () => void;
  send: (channel: 'appConfig') => void;
}

const APP_CONFIG_REQUEST_GRACE_MS = 100;
const APP_CONFIG_RESPONSE_TIMEOUT_MS = 1500;

const useStoreConfig = telemetrySettingsStore.useConfig();

function useTelemetryConfig(): TelemetryConfig {
  return { ...TELEMETRY_DEFAULTS, ...useStoreConfig() };
}

/**
 * Resolves the installed app version exactly once per component lifetime,
 * through the existing desktopApi appConfig handshake, and caches the
 * result so a mid-session consent grant does not redo the round trip.
 * Returns the cached promise plus a cleanup that cancels the in-flight
 * handshake (used only on unmount, before it ever settles).
 */
function startAppVersionResolution(): { promise: Promise<string>; cleanup: () => void } {
  let settled = false;
  let unsubscribe = () => {};
  let resolvePromise: (appVersion: string) => void = () => {};
  const promise = new Promise<string>(resolve => {
    resolvePromise = resolve;
  });

  const stopListening = () => {
    unsubscribe();
    unsubscribe = () => {};
  };
  const settle = (appVersion: string) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(requestTimer);
    window.clearTimeout(fallbackTimer);
    stopListening();
    resolvePromise(appVersion);
  };

  const desktopApi = (window as { desktopApi?: DesktopAppConfigApi }).desktopApi;
  let requestTimer = 0;
  let fallbackTimer = 0;
  if (!desktopApi?.receive || !desktopApi.send) {
    settle('unknown');
  } else {
    unsubscribe = desktopApi.receive('appConfig', config => {
      settle(config.appVersion || 'unknown');
    });
    requestTimer = window.setTimeout(() => {
      desktopApi.send('appConfig');
    }, APP_CONFIG_REQUEST_GRACE_MS);
    fallbackTimer = window.setTimeout(() => {
      settle('unknown');
    }, APP_CONFIG_RESPONSE_TIMEOUT_MS);
  }

  // Resolves rather than abandoning the promise: under a StrictMode
  // double-invoke, effect B (the consent effect below) can already be
  // awaiting this promise when effect A's cleanup fires. Leaving it
  // unsettled would hang that await forever, and because
  // previousEnabledRef is no longer null on the re-run, the re-invoked
  // effect A/B pair would never call initTelemetry either — silently
  // disabling telemetry for the whole session.
  //
  // Resolving is not by itself enough, because a genuine unmount runs the
  // same cleanup and would then let that continuation initialize telemetry
  // for a component that no longer exists. The caller distinguishes the two
  // with a mounted flag checked after the await — see TelemetryBoot below.
  const cleanup = () => {
    settle('unknown');
  };
  return { promise, cleanup };
}

/**
 * Boots telemetry when enabled and keeps it in sync with the config store
 * for the rest of the process — toggling the setting takes effect
 * immediately via `grantConsent`/`revokeConsent`, no restart required.
 * Renders nothing. StrictMode double-mount is handled by initTelemetry's
 * internal initAttempted guard, plus resolving (rather than abandoning)
 * the app-version promise on cleanup so a re-invoked mount can still
 * proceed to call initTelemetry at all.
 */
export default function TelemetryBoot(): null {
  const { enabled } = useTelemetryConfig();
  const appVersionRef = useRef<Promise<string> | null>(null);
  const previousEnabledRef = useRef<boolean | null>(null);
  // Cleared by effect A's cleanup, re-set by its body. React runs the
  // StrictMode unmount/remount replay synchronously within one commit, so an
  // `initialize` continuation — which resumes a microtask later, after the
  // cleanup settled the promise it was awaiting — still observes true. A
  // genuine unmount leaves it false and that continuation bails.
  const mountedRef = useRef(true);

  // Resolve the app version exactly once per mount, independent of
  // consent transitions, and cache it for `initialize` to await.
  useEffect(() => {
    mountedRef.current = true;
    const { promise, cleanup } = startAppVersionResolution();
    appVersionRef.current = promise;
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, []);

  // Mount-time only — deliberately `[]`-keyed, not `[enabled]` — so the flag
  // is set once before the consent effect below ever runs, and never again
  // on a later render. React runs effects in declaration order, so this
  // still lands before `initialize()` in that effect. Reads isTelemetryEnabled()
  // directly instead of closing over `enabled` so this has no dependency on
  // that value at all: at mount they're identical, since `enabled` comes from
  // a subscription to the same store.
  //
  // Do not key this on `[enabled]`. On a true-to-false render, an
  // `[enabled]`-keyed effect would call setTelemetryEnabled(false) —
  // unloading the SDK and clearing the enabled flag (`index.ts:70-78`) —
  // before the consent effect below could run revokeConsent(). emitConsentEvent()
  // returns early when telemetry is disabled, so the revoke event would never
  // be sent and opt-out rate (PRD outcome #16) would read zero forever. That
  // is the exact failure this entire workstream exists to prevent.
  useEffect(() => {
    setTelemetryEnabled(isTelemetryEnabled());
  }, []);

  useEffect(() => {
    const initialize = async () => {
      const appVersion = await (appVersionRef.current ?? Promise.resolve('unknown'));
      // A real unmount resolved that promise from cleanup; constructing a
      // client here would leave an App Insights instance and its send queue
      // owned by nothing, unreachable and never unloaded. A StrictMode replay
      // has already re-set this flag, so it still proceeds.
      //
      // When grantConsent injected this initialize, returning here makes it a
      // resolved no-op: grantConsent then emits 'granted' with no client, so
      // the event buffers into pendingEvents until some later initTelemetry
      // flushes it. That is the intended trade — the alternative is leaving
      // the consent gate closed for the rest of the process. Pinned by
      // consent.test.ts, 'an initialize that resolves without building a
      // client still completes the transition'.
      //
      // The live store re-check closes the launch race: initialize() can sit
      // on the ~1.5s appConfig handshake while the user opts out, and the
      // passive revoke effect may not have disabled telemetry yet. Building
      // the client here would emit session-start through initTelemetry's
      // deliberate emitInternal bypass — which no gate or predicate covers —
      // transmitting after opt-out. Read the store rather than `enabled`:
      // this closure captures the value from the render that scheduled it.
      if (!mountedRef.current || !isTelemetryEnabled()) return;
      try {
        const installId = getOrCreateInstallId();
        const appInfo = getAppInfo();
        initTelemetry({
          connectionString: CONNECTION_STRING,
          installId,
          sessionProps: {
            ...appInfo,
            appVersion,
            headlampVersion: HEADLAMP_VERSION,
            locale: navigator.language || 'unknown',
          },
        });
      } catch {
        // Fail closed. Telemetry failures never emit more telemetry or logs.
      }
    };

    // Mount-time enablement is handled here, directly — it is not a
    // transition, and must not also fire grantConsent (which would emit
    // a spurious 'granted' event on ordinary app launch).
    if (previousEnabledRef.current === null) {
      previousEnabledRef.current = enabled;
      if (enabled) {
        void initialize();
      }
      return;
    }

    const wasEnabled = previousEnabledRef.current;
    previousEnabledRef.current = enabled;
    if (!wasEnabled && enabled) {
      void grantConsent(initialize);
    } else if (wasEnabled && !enabled) {
      void revokeConsent();
    }
  }, [enabled]);

  return null;
}
