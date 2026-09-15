// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, TextField } from '@mui/material';
import React from 'react';
import { CONTAINER_STEPS } from '../hooks/useContainerConfiguration';
import { ContainerConfigProp, LabelWithInfo } from './configureContainerUtils';

interface BasicsStepProps {
  containerConfig: ContainerConfigProp;
  requireContainerImage?: boolean;
}

export default function BasicsStep({
  containerConfig,
  requireContainerImage = true,
}: BasicsStepProps) {
  const { t } = useTranslation();

  return (
    <>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          label={t('Application name')}
          value={containerConfig.config.appName}
          onChange={e => containerConfig.setConfig(c => ({ ...c, appName: e.target.value }))}
          fullWidth
        />
        <TextField
          label={t('Container image')}
          placeholder="registry/image:tag"
          value={containerConfig.config.containerImage}
          onChange={e => containerConfig.setConfig(c => ({ ...c, containerImage: e.target.value }))}
          fullWidth
        />
        <TextField
          label={
            <LabelWithInfo
              label={t('Replicas')}
              infoText={t(
                'The number of pod replicas to run. More replicas provide better availability and load distribution.'
              )}
            />
          }
          type="number"
          inputProps={{ min: 1 }}
          value={containerConfig.config.replicas}
          onChange={e =>
            containerConfig.setConfig(c => ({
              ...c,
              replicas: Math.max(1, Number(e.target.value)),
            }))
          }
        />
      </Box>
      <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
        <Button
          variant="contained"
          onClick={() =>
            containerConfig.setConfig(c => ({ ...c, containerStep: CONTAINER_STEPS.NETWORKING }))
          }
          disabled={
            !containerConfig.config.appName.trim() ||
            (requireContainerImage && !containerConfig.config.containerImage.trim()) ||
            containerConfig.config.replicas < 1
          }
        >
          {t('Continue')}
        </Button>
      </Box>
    </>
  );
}
