// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import React from 'react';
import { CONTAINER_STEPS } from '../hooks/useContainerConfiguration';
import { ContainerConfigProp, LabelWithInfo } from './configureContainerUtils';

interface NetworkingStepProps {
  containerConfig: ContainerConfigProp;
}

export default function NetworkingStep({ containerConfig }: NetworkingStepProps) {
  const { t } = useTranslation();

  return (
    <>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          label={
            <LabelWithInfo
              label={t('Container port (target port)')}
              infoText={t(
                'The port number your application listens on inside the container. In Kubernetes, this is called the target port.'
              )}
            />
          }
          type="number"
          inputProps={{ min: 1 }}
          value={containerConfig.config.targetPort}
          onChange={e =>
            containerConfig.setConfig(c => ({
              ...c,
              targetPort: Math.max(1, Number(e.target.value)),
            }))
          }
        />
        {containerConfig.config.useCustomServicePort && (
          <TextField
            label={
              <LabelWithInfo
                label={t('Service port')}
                infoText={t(
                  'The port number exposed by the Kubernetes service. Traffic to this port is forwarded to the target port.'
                )}
              />
            }
            type="number"
            inputProps={{ min: 1 }}
            value={containerConfig.config.servicePort}
            onChange={e =>
              containerConfig.setConfig(c => ({
                ...c,
                servicePort: Math.max(1, Number(e.target.value)),
              }))
            }
          />
        )}
      </Box>
      <Box sx={{ mt: 1 }}>
        <FormControlLabel
          control={
            <Switch
              checked={containerConfig.config.useCustomServicePort}
              onChange={e =>
                containerConfig.setConfig(c => ({
                  ...c,
                  useCustomServicePort: e.target.checked,
                }))
              }
            />
          }
          label={
            <LabelWithInfo
              label={t('Use custom service port')}
              infoText={t(
                'By default, the service port matches the target port. Enable this to use a different port for the service.'
              )}
            />
          }
        />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ ml: 5, display: 'block', mt: -1 }}
        >
          {t(
            'By default, the service port matches the target port. Enable this to use a different port for the service.'
          )}
        </Typography>
      </Box>
      <Box
        role="group"
        aria-label={t('Service type')}
        sx={{ display: 'flex', gap: 2, width: '100%', mt: 1 }}
      >
        <Box
          role="button"
          tabIndex={0}
          aria-pressed={containerConfig.config.serviceType === 'ClusterIP'}
          onClick={() => containerConfig.setConfig(c => ({ ...c, serviceType: 'ClusterIP' }))}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              containerConfig.setConfig(c => ({ ...c, serviceType: 'ClusterIP' }));
            }
          }}
          sx={{
            flex: 1,
            p: 2,
            border: '2px solid',
            borderColor:
              containerConfig.config.serviceType === 'ClusterIP' ? 'primary.main' : 'divider',
            borderRadius: 2,
            cursor: 'pointer',
            backgroundColor: 'background.paper',
          }}
        >
          <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
            {t('Internal only')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('Use ClusterIP. Best for services that are only reachable within the cluster.')}
          </Typography>
        </Box>
        <Box
          role="button"
          tabIndex={0}
          aria-pressed={containerConfig.config.serviceType === 'LoadBalancer'}
          onClick={() => containerConfig.setConfig(c => ({ ...c, serviceType: 'LoadBalancer' }))}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              containerConfig.setConfig(c => ({ ...c, serviceType: 'LoadBalancer' }));
            }
          }}
          sx={{
            flex: 1,
            p: 2,
            border: '2px solid',
            borderColor:
              containerConfig.config.serviceType === 'LoadBalancer' ? 'primary.main' : 'divider',
            borderRadius: 2,
            cursor: 'pointer',
            backgroundColor: 'background.paper',
          }}
        >
          <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
            {t('Enable public access')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('Creates a LoadBalancer to expose the application to the internet.')}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
        <Button
          variant="outlined"
          onClick={() =>
            containerConfig.setConfig(c => ({ ...c, containerStep: CONTAINER_STEPS.BASICS }))
          }
        >
          {t('Back')}
        </Button>
        <Button
          variant="contained"
          onClick={() =>
            containerConfig.setConfig(c => ({ ...c, containerStep: CONTAINER_STEPS.HEALTHCHECKS }))
          }
        >
          {t('Continue')}
        </Button>
      </Box>
    </>
  );
}
