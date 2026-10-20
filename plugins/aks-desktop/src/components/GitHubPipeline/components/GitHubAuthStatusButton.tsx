// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, CircularProgress, Popover, Tooltip, Typography } from '@mui/material';
import React, { useEffect, useId, useState } from 'react';
import { usePreviewFeatures } from '../../../hooks/usePreviewFeatures';
import { useGitHubAuthContext } from '../GitHubAuthContext';
import { GitHubDeviceCodePrompt } from './GitHubDeviceCodePrompt';

/** Project-wide account access without resetting pipeline state or browser sessions. */
export function GitHubAuthStatusButton() {
  const { githubPipelines } = usePreviewFeatures();
  const { authState, startOAuth, cancelOAuth, abortOAuth, reset } = useGitHubAuthContext();
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const dialogId = useId();
  useEffect(() => () => cancelOAuth(), [cancelOAuth]);
  if (!githubPipelines) return null;

  const close = () => {
    cancelOAuth();
    setAnchor(null);
  };
  const open = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchor(event.currentTarget);
    if (
      !authState.isAuthenticated &&
      !authState.isAuthorizingBrowser &&
      !authState.disconnectError
    ) {
      void startOAuth();
    }
  };
  const label = authState.isDisconnecting
    ? t('Disconnecting GitHub...')
    : authState.disconnectError
    ? t('GitHub disconnect failed')
    : authState.isAuthenticated
    ? authState.username ?? t('Connected')
    : t('Connect GitHub');
  const busy = authState.isRestoring || authState.isAuthorizingBrowser || authState.isDisconnecting;

  return (
    <>
      <Tooltip title={authState.isAuthenticated ? t('GitHub account') : label}>
        <span>
          <Button
            variant="outlined"
            onClick={open}
            disabled={authState.isRestoring || authState.isDisconnecting}
            aria-label={authState.isAuthenticated ? t('GitHub account') : label}
            aria-haspopup="dialog"
            aria-expanded={Boolean(anchor)}
            aria-controls={anchor ? dialogId : undefined}
            aria-busy={busy}
            startIcon={
              busy ? (
                <CircularProgress size={16} aria-hidden="true" />
              ) : (
                <Icon icon="mdi:github" aria-hidden="true" />
              )
            }
            sx={{ textTransform: 'none', fontWeight: 'bold' }}
          >
            {label}
          </Button>
        </span>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          id: dialogId,
          role: 'dialog',
          'aria-label': t('GitHub account'),
          sx: { p: 2, width: 360, maxWidth: 'calc(100vw - 32px)' },
        }}
      >
        {authState.disconnectError ? (
          <>
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('Saved GitHub credentials may remain. Retry disconnect before connecting again.')}
            </Alert>
            <Button variant="outlined" onClick={() => void reset()}>
              {t('Retry disconnect')}
            </Button>
          </>
        ) : authState.isAuthenticated || authState.isDisconnecting ? (
          <>
            {authState.error && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t(authState.error)}
              </Alert>
            )}
            <Typography role="status" variant="body2" sx={{ mb: 1 }}>
              {authState.isDisconnecting
                ? t('Removing saved GitHub credentials...')
                : t('Connected as {{username}}.', { username: authState.username })}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {t(
                'Disconnect removes saved GitHub credentials from this app only. Repositories and deployments are kept.'
              )}
            </Typography>
            <Button
              variant="outlined"
              disabled={authState.isDisconnecting}
              onClick={() => void reset()}
            >
              {t('Disconnect GitHub')}
            </Button>
          </>
        ) : authState.isAuthorizingBrowser ? (
          <GitHubDeviceCodePrompt
            authorization={authState.deviceAuthorization}
            onCancel={() => {
              abortOAuth();
              setAnchor(null);
            }}
          />
        ) : (
          <Box>
            {authState.error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {t(authState.error)}
              </Alert>
            )}
            <Button
              variant="outlined"
              disabled={authState.isRestoring}
              onClick={() => void startOAuth()}
            >
              {t('Connect GitHub')}
            </Button>
          </Box>
        )}
      </Popover>
    </>
  );
}
