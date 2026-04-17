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
import type { UseDockerfileDiscoveryReturn } from '../hooks/useDockerfileDiscovery';

interface DockerfileConfirmationProps {
  /**
   * Repo-relative paths to Dockerfiles found in the repository tree,
   * e.g. `['Dockerfile', 'src/web/Dockerfile']`. Pass `RepoReadiness.dockerfilePaths ?? []`
   * to coerce the nullable readiness value — an empty array causes the component to render nothing.
   * Must come from the same discovery run as `discovery` so that `selection.path` is
   * always a member of this array.
   */
  dockerfilePaths: string[];
  /**
   * Selection state from `useDockerfileDiscovery`. The hook guarantees that
   * `selection.path` is always a member of the `dockerfilePaths` that was
   * passed to the hook, so these two props must come from the same source.
   */
  discovery: UseDockerfileDiscoveryReturn;
}

export function DockerfileConfirmation({
  dockerfilePaths,
  discovery,
}: DockerfileConfirmationProps) {
  const { t } = useTranslation();
  const { selection, setSelectedPath, setBuildContext } = discovery;

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
          <Select<string>
            labelId="dockerfile-select-label"
            id="dockerfile-select"
            value={selection?.path ?? ''}
            label={t('Dockerfile')}
            onChange={e => setSelectedPath(e.target.value)}
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
          onChange={e => setBuildContext(e.target.value)}
          helperText={t('Directory used as the Docker build context')}
          FormHelperTextProps={{ id: 'docker-build-context-help' }}
          inputProps={{ 'aria-describedby': 'docker-build-context-help' }}
        />
      )}
    </Box>
  );
}
