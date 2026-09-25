// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, IconButton, TextField, Tooltip } from '@mui/material';
import React from 'react';
import { CONTAINER_STEPS } from '../hooks/useContainerConfiguration';
import { ContainerConfigProp, ENV_VAR_KEY_PATTERN } from './configureContainerUtils';

interface EnvVarsStepProps {
  containerConfig: ContainerConfigProp;
}

export default function EnvVarsStep({ containerConfig }: EnvVarsStepProps) {
  const { t } = useTranslation();
  const hasInvalidKeys = containerConfig.config.envVars.some(
    e => e.key.trim().length > 0 && !ENV_VAR_KEY_PATTERN.test(e.key)
  );

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {containerConfig.config.envVars.map((pair, idx) => (
          <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              label={t('Key')}
              value={pair.key}
              error={!!pair.key.trim() && !ENV_VAR_KEY_PATTERN.test(pair.key)}
              helperText={
                pair.key.trim() && !ENV_VAR_KEY_PATTERN.test(pair.key)
                  ? t(
                      'Keys must start with a letter or underscore and contain only letters, numbers, and underscores.'
                    )
                  : ''
              }
              onChange={e => {
                const v = [...containerConfig.config.envVars];
                v[idx] = { ...v[idx], key: e.target.value };
                containerConfig.setConfig(c => ({ ...c, envVars: v }));
              }}
              sx={{ flex: 1 }}
            />
            <TextField
              label={t('Value')}
              value={pair.value}
              type={pair.isSecret ? 'password' : 'text'}
              placeholder={
                pair.isSecret && !pair.value ? t('(existing — enter value to overwrite)') : ''
              }
              onChange={e => {
                const v = [...containerConfig.config.envVars];
                v[idx] = { ...v[idx], value: e.target.value };
                containerConfig.setConfig(c => ({ ...c, envVars: v }));
              }}
              sx={{ flex: 1 }}
            />
            <Tooltip
              title={
                pair.isSecret
                  ? t('Stored as Kubernetes Secret')
                  : t('Mark as secret (stored as Kubernetes Secret)')
              }
            >
              <IconButton
                aria-label={t('toggle secret')}
                onClick={() => {
                  const v = [...containerConfig.config.envVars];
                  v[idx] = { ...v[idx], isSecret: !v[idx].isSecret };
                  containerConfig.setConfig(c => ({ ...c, envVars: v }));
                }}
              >
                <Icon icon={pair.isSecret ? 'mdi:lock-outline' : 'mdi:lock-open-outline'} />
              </IconButton>
            </Tooltip>
            <IconButton
              aria-label={t('remove')}
              onClick={() =>
                containerConfig.setConfig(c => ({
                  ...c,
                  envVars: c.envVars.filter((_, i) => i !== idx),
                }))
              }
            >
              <Icon icon="mdi:delete-outline" />
            </IconButton>
          </Box>
        ))}
        <Box>
          <Button
            variant="text"
            onClick={() =>
              containerConfig.setConfig(c => ({
                ...c,
                envVars: [...c.envVars, { key: '', value: '', isSecret: false }],
              }))
            }
          >
            {t('Add variable')}
          </Button>
        </Box>
      </Box>
      <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
        <Button
          variant="outlined"
          onClick={() =>
            containerConfig.setConfig(c => ({ ...c, containerStep: CONTAINER_STEPS.RESOURCES }))
          }
        >
          {t('Back')}
        </Button>
        <Button
          variant="contained"
          disabled={hasInvalidKeys}
          onClick={() =>
            containerConfig.setConfig(c => ({ ...c, containerStep: CONTAINER_STEPS.HPA }))
          }
        >
          {t('Continue')}
        </Button>
      </Box>
    </>
  );
}
