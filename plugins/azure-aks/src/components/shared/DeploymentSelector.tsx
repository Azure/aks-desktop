// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, CircularProgress, FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import React from 'react';

interface DeploymentSelectorProps {
  selectedDeployment: string;
  deployments: Array<{ name: string }>;
  loading?: boolean;
  onDeploymentChange: (deploymentName: string) => void;
  sx?: SxProps<Theme>;
  /** When true, suppress the visually-hidden live region to avoid duplicate announcements
   *  when multiple DeploymentSelector instances appear on the same page. */
  suppressLiveRegion?: boolean;
}

/**
 * Dropdown selector for choosing a deployment
 */
export const DeploymentSelector: React.FC<DeploymentSelectorProps> = ({
  selectedDeployment,
  deployments,
  loading = false,
  onDeploymentChange,
  sx,
  suppressLiveRegion = false,
}) => {
  const { t } = useTranslation();
  const id = React.useId();
  const labelId = `${id}-deployment-selector-label`;
  const selectId = `${id}-deployment-selector`;

  return (
    <>
      {!suppressLiveRegion && (
        <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>
          {!loading && deployments.length === 0 ? t('No deployments found') : ''}
        </Box>
      )}
      <FormControl
        sx={[{ minWidth: 200 }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
        size="small"
        variant="outlined"
      >
        <InputLabel id={labelId}>{t('Select Deployment')}</InputLabel>
        <Select
          id={selectId}
          labelId={labelId}
          value={selectedDeployment || ''}
          onChange={e => onDeploymentChange(e.target.value as string)}
          label={t('Select Deployment')}
          disabled={loading || deployments.length === 0}
        >
          {loading ? (
            <MenuItem disabled>
              <CircularProgress size={16} style={{ marginRight: 8 }} />
              {t('Loading deployments')}...
            </MenuItem>
          ) : deployments.length === 0 ? (
            <MenuItem disabled>{t('No deployments found')}</MenuItem>
          ) : (
            deployments.map(deployment => (
              <MenuItem key={deployment.name} value={deployment.name}>
                {deployment.name}
              </MenuItem>
            ))
          )}
        </Select>
      </FormControl>
    </>
  );
};
