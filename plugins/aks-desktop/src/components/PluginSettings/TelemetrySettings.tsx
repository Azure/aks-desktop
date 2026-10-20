// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, FormControlLabel, Switch, Typography } from '@mui/material';
import React from 'react';
import {
  TELEMETRY_DEFAULTS,
  type TelemetryConfig,
  telemetrySettingsStore,
} from './telemetrySettingsStore';

const useStoreConfig = telemetrySettingsStore.useConfig();

function useTelemetryConfig(): TelemetryConfig {
  return { ...TELEMETRY_DEFAULTS, ...useStoreConfig() };
}

export default function TelemetrySettings() {
  const { t } = useTranslation();
  const config = useTelemetryConfig();

  function handleToggle(checked: boolean) {
    telemetrySettingsStore.update({ enabled: checked });
  }

  return (
    <Box sx={{ maxWidth: 600 }}>
      <Typography variant="h6">{t('Telemetry')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(
          'AKS Desktop sends pseudonymous usage data (feature usage, app version, OS, error classes) to help us improve the product. A random pseudonymous installation identifier stored on this device is included so sessions from the same installation can be counted. No cluster names, namespaces, resource names, error messages, or stack traces are ever sent.'
        )}
      </Typography>
      <FormControlLabel
        control={
          <Switch checked={config.enabled} onChange={(_e, checked) => handleToggle(checked)} />
        }
        label={<Typography variant="body1">{t('Send pseudonymous usage data')}</Typography>}
        sx={{ alignItems: 'flex-start', ml: 0, mt: 1 }}
      />
    </Box>
  );
}
