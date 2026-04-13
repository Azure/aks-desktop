// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import type { DockerfileSelection } from '../hooks/useDockerfileDiscovery';

interface DockerfileConfirmationProps {
  /**
   * Repo-relative paths to Dockerfiles found in the repository tree,
   * e.g. ['Dockerfile', 'src/web/Dockerfile']. When empty, the component renders nothing.
   */
  dockerfilePaths: string[];
  selection: DockerfileSelection | null;
  onSelect: (path: string) => void;
  onBuildContextChange: (buildContext: string) => void;
}

export function DockerfileConfirmation({
  dockerfilePaths,
  selection,
  onSelect,
  onBuildContextChange,
}: DockerfileConfirmationProps) {
  const { t } = useTranslation();

  if (dockerfilePaths.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="success" variant="outlined" role="status" aria-live="polite">
        {dockerfilePaths.length === 1
          ? t('Dockerfile found at {{path}}', { path: dockerfilePaths[0] })
          : t('{{count}} Dockerfiles found — select one below', { count: dockerfilePaths.length })}
      </Alert>

      {dockerfilePaths.length > 1 && (
        <FormControl fullWidth size="small">
          <InputLabel id="dockerfile-select-label">{t('Dockerfile')}</InputLabel>
          <Select
            labelId="dockerfile-select-label"
            id="dockerfile-select"
            value={selection?.path ?? ''}
            label={t('Dockerfile')}
            onChange={e => onSelect(e.target.value)}
            displayEmpty
          >
            <MenuItem value="" disabled aria-hidden="true">
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                {t('Select a Dockerfile')}
              </Typography>
            </MenuItem>
            {dockerfilePaths.map(path => (
              <MenuItem key={path} value={path}>
                {path}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {selection && (
        <TextField
          id="docker-build-context"
          label={t('Build context')}
          size="small"
          value={selection.buildContext}
          onChange={e => onBuildContextChange(e.target.value)}
          helperText={t('Directory used as the Docker build context')}
          FormHelperTextProps={{ id: 'docker-build-context-help' }}
          inputProps={{ 'aria-describedby': 'docker-build-context-help' }}
        />
      )}
    </Box>
  );
}
