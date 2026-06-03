// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import React, { useEffect, useRef } from 'react';
import { getAppInfo } from '../telemetry/appInfo';
import { getInstallId } from '../telemetry/installId';
import { enableTelemetry } from '../telemetry/setup';
import { isTelemetryEnabled } from './PluginSettings/telemetrySettingsStore';

const CONNECTION_STRING = import.meta.env.REACT_APP_APPINSIGHTS_CONNECTION_STRING as
  | string
  | undefined;

/**
 * Boots App Insights telemetry exactly once on first mount when:
 *   - the opt-out toggle is enabled (default true)
 *   - a connection string was substituted at plugin build time
 *   - the install-id and app-info bridges are available
 *
 * Renders nothing. Mount this from a registration point that's always
 * present (e.g. `registerAppBarAction`).
 */
export default function TelemetryBoot(): React.ReactElement | null {
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    if (!isTelemetryEnabled()) return;
    if (!CONNECTION_STRING) return;

    (async () => {
      const [installId, appInfo] = await Promise.all([getInstallId(), getAppInfo()]);
      if (!installId || !appInfo) return;

      enableTelemetry({
        connectionString: CONNECTION_STRING,
        installId,
        sessionProps: {
          installId,
          appVersion:
            (import.meta.env.REACT_APP_AKS_DESKTOP_VERSION as string | undefined) ?? 'unknown',
          headlampVersion:
            (import.meta.env.REACT_APP_HEADLAMP_VERSION as string | undefined) ?? 'unknown',
          electronVersion: appInfo.electronVersion,
          os: appInfo.os,
          osMajor: appInfo.osMajor,
          arch: appInfo.arch,
          locale: navigator.language || 'unknown',
        },
      });
    })();
  }, []);

  return null;
}
