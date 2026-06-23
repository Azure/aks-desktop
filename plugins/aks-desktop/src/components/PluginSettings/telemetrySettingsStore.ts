// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';

export interface TelemetryConfig {
  enabled: boolean;
}

export const TELEMETRY_DEFAULTS: TelemetryConfig = {
  enabled: true,
};

export const telemetrySettingsStore = new ConfigStore<TelemetryConfig>('aks-desktop.telemetry');

/** Sync read. Safe outside React. */
export function isTelemetryEnabled(): boolean {
  return telemetrySettingsStore.get()?.enabled ?? TELEMETRY_DEFAULTS.enabled;
}
