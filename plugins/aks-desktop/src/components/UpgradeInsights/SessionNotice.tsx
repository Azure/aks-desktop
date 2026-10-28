// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Button, CircularProgress, Stack } from '@mui/material';
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';

/** Presentational access state; account discovery remains owned by the page. */
export interface SessionNoticeProps {
  /** Gate or account-check state preventing subscription discovery. */
  state: 'disabled' | 'checking' | 'signedOut';
  /** Optional native authentication failure shown alongside the sign-in link. */
  error?: string;
}

/**
 * Show the current access boundary without invoking Azure or authentication hooks.
 * @param props Blocking session state and any native authentication error.
 * @returns The existing preview notice, account progress, or native sign-in link.
 */
export default function SessionNotice({ state, error }: SessionNoticeProps) {
  const { t } = useTranslation();
  if (state === 'disabled') {
    return (
      <Alert severity="info">
        {t('Upgrade Insights is disabled. Enable it in AKS Desktop Preview Features settings.')}
      </Alert>
    );
  }
  if (state === 'checking') {
    return <CircularProgress aria-label={t('Checking Azure account')} />;
  }
  return (
    <Stack spacing={2}>
      <Alert severity="info">{t('Sign in to Azure to view Upgrade Insights.')}</Alert>
      {error && <Alert severity="error">{error}</Alert>}
      <Button component={RouterLink} to="/azure/login">
        {t('Sign in to Azure')}
      </Button>
    </Stack>
  );
}
