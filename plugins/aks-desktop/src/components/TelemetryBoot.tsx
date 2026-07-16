// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useRef } from 'react';
import { initTelemetry, setTelemetryEnabled } from '../telemetry';
import { getAppInfo } from '../telemetry/appInfo';
import { getOrCreateInstallId } from '../telemetry/installId';
import { isTelemetryEnabled } from './PluginSettings/telemetrySettingsStore';

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

const APP_VERSION =
  (import.meta.env.REACT_APP_AKS_DESKTOP_VERSION as string | undefined) ?? 'unknown';

const HEADLAMP_VERSION =
  (import.meta.env.REACT_APP_HEADLAMP_VERSION as string | undefined) ?? 'unknown';

/**
 * Boots telemetry once when telemetry is enabled (the user has not
 * opted out). Renders nothing; mount from a registration point that's
 * always present. The boot is one-shot per process — toggling the
 * setting at runtime requires a restart to take effect, which
 * TelemetrySettings surfaces to the user. StrictMode double-mount is
 * handled by initTelemetry's internal initAttempted guard.
 */
export default function TelemetryBoot(): null {
  const enabled = useRef(isTelemetryEnabled()).current;
  setTelemetryEnabled(enabled);

  useEffect(() => {
    if (!enabled) return;

    try {
      const installId = getOrCreateInstallId();
      const appInfo = getAppInfo();
      initTelemetry({
        connectionString: CONNECTION_STRING,
        installId,
        sessionProps: {
          ...appInfo,
          appVersion: APP_VERSION,
          headlampVersion: HEADLAMP_VERSION,
          locale: navigator.language || 'unknown',
        },
      });
    } catch {
      // Fail closed. Telemetry failures never emit more telemetry or logs.
    }
  }, [enabled]);
  return null;
}
