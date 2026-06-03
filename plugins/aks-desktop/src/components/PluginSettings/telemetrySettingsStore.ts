// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';

export interface TelemetrySettingsConfig {
  enabled: boolean;
}

export const TELEMETRY_SETTINGS_DEFAULTS: TelemetrySettingsConfig = {
  enabled: true,
};

/**
 * Persisted via Headlamp's ConfigStore (renderer-side, localStorage).
 *
 * Key is namespaced separately from `previewFeaturesStore` so the two
 * stores don't collide.
 */
export const telemetrySettingsStore = new ConfigStore<TelemetrySettingsConfig>(
  'aks-desktop.telemetry'
);

/**
 * Read the current telemetry-enabled flag synchronously, defaulting to
 * true when no persisted value exists. Used at plugin load time to
 * decide whether to initialize App Insights.
 */
export function isTelemetryEnabled(): boolean {
  const stored = telemetrySettingsStore.get()?.enabled;
  return stored ?? TELEMETRY_SETTINGS_DEFAULTS.enabled;
}
