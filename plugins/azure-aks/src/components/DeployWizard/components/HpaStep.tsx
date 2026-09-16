// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  FormControlLabel,
  InputAdornment,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import { CONTAINER_STEPS } from '../hooks/useContainerConfiguration';
import { ContainerConfigProp, LabelWithInfo } from './configureContainerUtils';

interface HpaStepProps {
  containerConfig: ContainerConfigProp;
}

export default function HpaStep({ containerConfig }: HpaStepProps) {
  const { t } = useTranslation();

  return (
    <>
      <FormControlLabel
        control={
          <Switch
            checked={containerConfig.config.enableHpa}
            onChange={e => containerConfig.setConfig(c => ({ ...c, enableHpa: e.target.checked }))}
          />
        }
        label={
          <LabelWithInfo
            label={t('Enable Horizontal Pod Autoscaler')}
            infoText={t(
              "Automatically scales the number of pods based on CPU utilization. HPA will increase pods when CPU usage exceeds the target and decrease when it's below."
            )}
          />
        }
      />
      {containerConfig.config.enableHpa && (
        <Box
          sx={{
            mt: 1,
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('HPA scales pods based on CPU utilization.')}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))',
              gap: 2,
            }}
          >
            <TextField
              label={
                <LabelWithInfo
                  label={t('Min replicas')}
                  infoText={t(
                    'The minimum number of pod replicas that HPA will maintain, even when CPU usage is low.'
                  )}
                />
              }
              type="number"
              inputProps={{ min: 1 }}
              value={containerConfig.config.hpaMinReplicas}
              onChange={e => {
                const v = Math.max(1, Number(e.target.value));
                containerConfig.setConfig(c => ({
                  ...c,
                  hpaMinReplicas: v,
                  ...(v > c.hpaMaxReplicas ? { hpaMaxReplicas: v } : {}),
                }));
              }}
            />
            <TextField
              label={
                <LabelWithInfo
                  label={t('Max replicas')}
                  infoText={t(
                    'The maximum number of pod replicas that HPA can scale up to when CPU usage is high.'
                  )}
                />
              }
              type="number"
              inputProps={{ min: 1 }}
              value={containerConfig.config.hpaMaxReplicas}
              onChange={e => {
                const v = Math.max(1, Number(e.target.value));
                containerConfig.setConfig(c => ({
                  ...c,
                  hpaMaxReplicas: v,
                  ...(v < c.hpaMinReplicas ? { hpaMinReplicas: v } : {}),
                }));
              }}
            />
          </Box>

          <Box sx={{ mt: 3 }}>
            <TextField
              label={
                <LabelWithInfo
                  label={t('Target CPU utilization')}
                  infoText={t(
                    "The target average CPU utilization percentage across all pods. HPA will scale up when CPU usage exceeds this value and scale down when it's below."
                  )}
                />
              }
              type="number"
              value={containerConfig.config.hpaTargetCpu}
              inputProps={{ min: 10, max: 95, step: 5 }}
              onChange={e =>
                containerConfig.setConfig(c => ({
                  ...c,
                  hpaTargetCpu: Math.max(10, Math.min(95, Number(e.target.value))),
                }))
              }
              InputProps={{
                endAdornment: <InputAdornment position="end">%</InputAdornment>,
              }}
              sx={{ width: 120 }}
            />

            {(containerConfig.config.hpaMinReplicas > containerConfig.config.hpaMaxReplicas ||
              containerConfig.config.hpaTargetCpu < 10 ||
              containerConfig.config.hpaTargetCpu > 95) && (
              <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
                {t('Ensure min ≤ max replicas and target CPU between 10% and 95%.')}
              </Typography>
            )}
          </Box>
        </Box>
      )}
      <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
        <Button
          variant="outlined"
          onClick={() =>
            containerConfig.setConfig(c => ({ ...c, containerStep: CONTAINER_STEPS.ENV_VARS }))
          }
        >
          {t('Back')}
        </Button>
        <Button
          variant="contained"
          onClick={() =>
            containerConfig.setConfig(c => ({
              ...c,
              containerStep: CONTAINER_STEPS.WORKLOAD_IDENTITY,
            }))
          }
        >
          {t('Continue')}
        </Button>
      </Box>
    </>
  );
}
