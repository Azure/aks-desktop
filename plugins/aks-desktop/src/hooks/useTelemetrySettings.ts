// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  TELEMETRY_SETTINGS_DEFAULTS,
  type TelemetrySettingsConfig,
  telemetrySettingsStore,
} from '../components/PluginSettings/telemetrySettingsStore';

const useStoreConfig = telemetrySettingsStore.useConfig();

export function useTelemetrySettings(): TelemetrySettingsConfig {
  const stored = useStoreConfig();
  return { ...TELEMETRY_SETTINGS_DEFAULTS, ...stored };
}
