// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Alert, Box, FormControl, InputLabel, MenuItem, Select, TextField } from '@mui/material';
import React from 'react';
import type { DockerfileSelection } from '../hooks/useDockerfileDiscovery';

interface DockerfileConfirmationProps {
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
  if (dockerfilePaths.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="success" variant="outlined">
        {dockerfilePaths.length === 1
          ? `Dockerfile found at ${dockerfilePaths[0]}`
          : `${dockerfilePaths.length} Dockerfiles found — select one below`}
      </Alert>

      {dockerfilePaths.length > 1 && (
        <FormControl fullWidth size="small">
          <InputLabel>Dockerfile</InputLabel>
          <Select
            value={selection?.path ?? ''}
            label="Dockerfile"
            onChange={e => onSelect(e.target.value)}
            displayEmpty
          >
            <MenuItem value="" disabled>
              <em>Select a Dockerfile</em>
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
          label="Build context"
          size="small"
          value={selection.buildContext}
          onChange={e => onBuildContextChange(e.target.value)}
          helperText="Directory used as the Docker build context"
        />
      )}
    </Box>
  );
}
