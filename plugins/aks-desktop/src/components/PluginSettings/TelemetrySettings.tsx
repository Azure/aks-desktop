// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, FormControlLabel, Switch, Typography } from '@mui/material';
import React from 'react';
import { useTelemetrySettings } from '../../hooks/useTelemetrySettings';
import { telemetrySettingsStore } from './telemetrySettingsStore';

export default function TelemetrySettings() {
  const { t } = useTranslation();
  const config = useTelemetrySettings();

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
        label={
          <Box>
            <Typography variant="body1">{t('Send anonymous usage data')}</Typography>
          </Box>
        }
        sx={{ alignItems: 'flex-start', ml: 0, mt: 1 }}
      />
    </Box>
  );
}
