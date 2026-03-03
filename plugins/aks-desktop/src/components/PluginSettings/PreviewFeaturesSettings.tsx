// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Box, FormControlLabel, Switch, Typography } from '@mui/material';
import React from 'react';
import {
  PREVIEW_FEATURES_DEFAULTS,
  type PreviewFeaturesConfig,
  previewFeaturesStore,
} from './previewFeaturesStore';

const useStoreConfig = previewFeaturesStore.useConfig();

export default function PreviewFeaturesSettings() {
  const stored = useStoreConfig();
  const config: PreviewFeaturesConfig = { ...PREVIEW_FEATURES_DEFAULTS, ...stored };

  function handleToggle(key: keyof PreviewFeaturesConfig, checked: boolean) {
    previewFeaturesStore.update({ [key]: checked });
  }

  return (
    <Box sx={{ maxWidth: 600 }}>
      <Typography variant="h6">Preview Features</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Enable or disable features that are still in development. Preview features may change or be
        removed in future releases.
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
            <Typography variant="body1">GitHub Pipelines</Typography>
            <Typography variant="body2" color="text.secondary">
              Enable GitHub-based deployment pipelines for AKS projects.
            </Typography>
          </Box>
        }
        sx={{ alignItems: 'flex-start', ml: 0, mt: 1 }}
      />
    </Box>
  );
}
