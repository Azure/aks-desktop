// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Button, CircularProgress, Tooltip } from '@mui/material';
import React from 'react';
import { usePreviewFeatures } from '../../../hooks/usePreviewFeatures';
import { useGitHubAuthContext } from '../GitHubAuthContext';

/**
 * Button showing GitHub auth status. Placed in the project header
 * so users can sign in / see sign-in status from anywhere in the project.
 */
export function GitHubAuthStatusButton() {
  const { githubPipelines } = usePreviewFeatures();
  const { authState, startOAuth } = useGitHubAuthContext();

  if (!githubPipelines) return null;

  if (authState.isRestoring || authState.isAuthorizingBrowser) {
    return (
      <Tooltip
        title={
          authState.isRestoring ? 'Connecting to GitHub...' : 'Waiting for browser authorization...'
        }
      >
        <Button
          variant="outlined"
          startIcon={<CircularProgress size={16} />}
          disabled
          sx={{ textTransform: 'none', fontWeight: 'bold' }}
        >
          Connect GitHub
        </Button>
      </Tooltip>
    );
  }

  if (authState.isAuthenticated) {
    return (
      <Tooltip title={`GitHub: ${authState.username}`}>
        <Button
          variant="outlined"
          startIcon={<Icon icon="mdi:github" />}
          sx={{ textTransform: 'none', fontWeight: 'bold' }}
        >
          {authState.username ?? 'Connected'}
        </Button>
      </Tooltip>
    );
  }

  return (
    <Tooltip title="Sign in to GitHub">
      <Button
        variant="outlined"
        startIcon={<Icon icon="mdi:github" />}
        onClick={startOAuth}
        sx={{ textTransform: 'none', fontWeight: 'bold' }}
      >
        Connect GitHub
      </Button>
    </Tooltip>
  );
}
