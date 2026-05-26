// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, FormControlLabel, Switch, Typography } from '@mui/material';
import React from 'react';
import { usePreviewFeatures } from '../../hooks/usePreviewFeatures';
import { type PreviewFeaturesConfig, previewFeaturesStore } from './previewFeaturesStore';

export default function PreviewFeaturesSettings() {
  const { t } = useTranslation();
  const config = usePreviewFeatures();

  function handleToggle(key: keyof PreviewFeaturesConfig, checked: boolean) {
    previewFeaturesStore.update({ [key]: checked });
  }

  return (
    <Box sx={{ maxWidth: 600 }}>
      <Typography variant="h6">{t('Preview Features')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(
          'Enable or disable features that are still in development. Preview features may change or be removed in future releases.'
        )}
      </Typography>

      <FormControlLabel
        control={
          <Switch
            checked={config.githubPipelines}
            onChange={(_e, checked) => handleToggle('githubPipelines', checked)}
          />
        }
        label={
          <Box>
            <Typography variant="body1">{t('GitHub Pipelines')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('Enable GitHub-based deployment pipelines for AKS projects.')}
            </Typography>
          </Box>
        }
        sx={{ alignItems: 'flex-start', ml: 0, mt: 1 }}
      />

      <FormControlLabel
        control={
          <Switch
            checked={config.bareMetalEnvironment}
            onChange={(_e, checked) => handleToggle('bareMetalEnvironment', checked)}
          />
        }
        label={
          <Box>
            <Typography variant="body1">{t('BareMetal Test Environment')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t(
                'Enable setup and teardown of AKS BareMetal test environments using the aksArc jumpstart scripts.'
              )}
            </Typography>
          </Box>
        }
        sx={{ alignItems: 'flex-start', ml: 0, mt: 1 }}
      />
    </Box>
  );
}
