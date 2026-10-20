// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Button, CircularProgress, Popover, Tooltip, Typography } from '@mui/material';
import React, { useState } from 'react';
import { usePreviewFeatures } from '../../../hooks/usePreviewFeatures';
import { useGitHubAuthContext } from '../GitHubAuthContext';

/**
 * Button showing GitHub auth status. Placed in the project header
 * so users can sign in / see sign-in status from anywhere in the project.
 */
export function GitHubAuthStatusButton() {
  const { githubPipelines } = usePreviewFeatures();
  const { authState, startOAuth, reset } = useGitHubAuthContext();
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

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

  if (authState.isAuthenticated || authState.isDisconnecting || authState.disconnectError) {
    const label = authState.disconnectError
      ? t('GitHub disconnect failed')
      : authState.isDisconnecting
      ? t('Disconnecting GitHub...')
      : authState.username ?? t('Connected');
    return (
      <>
        <Tooltip title={t('GitHub: {{username}}', { username: authState.username ?? label })}>
          <Button
            variant="outlined"
            disabled={authState.isDisconnecting}
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={Boolean(anchor)}
            onClick={event => setAnchor(event.currentTarget)}
            startIcon={<Icon icon="mdi:github" aria-hidden="true" />}
            sx={{ textTransform: 'none', fontWeight: 'bold' }}
          >
            {label}
          </Button>
        </Tooltip>
        <Popover
          open={Boolean(anchor)}
          anchorEl={anchor}
          onClose={() => setAnchor(null)}
          PaperProps={{
            role: 'dialog',
            'aria-label': t('GitHub account'),
            sx: { p: 2, maxWidth: 360 },
          }}
        >
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t(
              'Disconnect removes saved GitHub credentials from this app only. Repositories and deployments are kept.'
            )}
          </Typography>
          {authState.disconnectError && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('Saved GitHub credentials could not be removed. Retry disconnect.')}
            </Alert>
          )}
          <Button
            variant="outlined"
            onClick={() => {
              setAnchor(null);
              void reset();
            }}
          >
            {authState.disconnectError ? t('Retry disconnect') : t('Disconnect GitHub')}
          </Button>
        </Popover>
      </>
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
