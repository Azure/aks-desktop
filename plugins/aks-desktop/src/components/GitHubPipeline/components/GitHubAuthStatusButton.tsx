// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
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
  const { t } = useTranslation();

  if (!githubPipelines) return null;

  if (authState.isRestoring || authState.isAuthorizingBrowser) {
    return (
      <Tooltip
        title={
          authState.isRestoring
            ? t('Connecting to GitHub...')
            : t('Waiting for browser authorization...')
        }
      >
        <Button
          variant="outlined"
          startIcon={<CircularProgress size={16} />}
          disabled
          sx={{ textTransform: 'none', fontWeight: 'bold' }}
        >
          {t('Connect GitHub')}
        </Button>
      </Tooltip>
    );
  }

  if (authState.isAuthenticated) {
    return (
      <Tooltip title={t('GitHub: {{username}}', { username: authState.username })}>
        <Button
          variant="outlined"
          startIcon={<Icon icon="mdi:github" aria-hidden="true" />}
          sx={{ textTransform: 'none', fontWeight: 'bold' }}
        >
          {authState.username ?? t('Connected')}
        </Button>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={t('Sign in to GitHub')}>
      <Button
        variant="outlined"
        startIcon={<Icon icon="mdi:github" aria-hidden="true" />}
        onClick={startOAuth}
        sx={{ textTransform: 'none', fontWeight: 'bold' }}
      >
        {t('Connect GitHub')}
      </Button>
    </Tooltip>
  );
}
