// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, IconButton, Tooltip } from '@mui/material';
import React from 'react';
import { ContainerConfig } from '../hooks/useContainerConfiguration';

/** POSIX environment variable name: letter or underscore, then alphanumerics/underscores. */
export const ENV_VAR_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function LabelWithInfo({ label, infoText }: { label: string; infoText: string }) {
  const { t } = useTranslation();

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <span>{label}</span>
      <Tooltip title={infoText} arrow>
        <IconButton aria-label={t('Information about {{label}}', { label })}>
          <Icon icon="mdi:information-outline" width="16px" height="16px" aria-hidden />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export interface ContainerConfigProp {
  config: ContainerConfig;
  setConfig: React.Dispatch<React.SetStateAction<ContainerConfig>>;
}

/** Azure context needed for workload identity setup in the Deploy Wizard. */
export interface DeployAzureContext {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  isManagedNamespace?: boolean;
  azureRbacEnabled?: boolean;
}
