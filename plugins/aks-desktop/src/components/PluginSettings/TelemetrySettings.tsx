// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, FormControlLabel, Switch, Typography } from '@mui/material';
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

  // Snapshot the enabled state at mount so the restart notice only shows
  // when the user has toggled the setting during this session, not on
  // every render or when initTelemetry has merely been attempted.
  const initialEnabled = React.useRef(config.enabled).current;
  const needsRestart = config.enabled !== initialEnabled;

  function handleToggle(checked: boolean) {
    telemetrySettingsStore.update({ enabled: checked });
  }

  return (
    <Box sx={{ maxWidth: 600 }}>
      <Typography variant="h6">{t('Telemetry')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(
          'AKS Desktop sends anonymous usage data (feature usage, app version, OS, error classes) to help us improve the product. No cluster names, namespaces, resource names, error messages, or stack traces are ever sent. Telemetry changes take effect on next launch.'
        )}
      </Typography>
      <FormControlLabel
        control={
          <Switch checked={config.enabled} onChange={(_e, checked) => handleToggle(checked)} />
        }
        label={<Typography variant="body1">{t('Send anonymous usage data')}</Typography>}
        sx={{ alignItems: 'flex-start', ml: 0, mt: 1 }}
      />
      {needsRestart && (
        <Alert severity="info" sx={{ mt: 2 }}>
          {t('Restart AKS Desktop for this change to take effect.')}
        </Alert>
      )}
    </Box>
  );
}
