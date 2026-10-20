// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, Typography } from '@mui/material';
import React from 'react';
import type { GitHubAuthState } from '../../../types/github';
import { openExternalUrl } from '../../../utils/shared/openExternalUrl';

interface Props {
  authorization: GitHubAuthState['deviceAuthorization'];
  onCancel: () => void;
}

/** Stable controls preserve keyboard focus while the initial device grant arrives. */
export function GitHubDeviceCodePrompt({ authorization, onCancel }: Props) {
  const { t } = useTranslation();
  return (
    <Box sx={{ mb: 2 }}>
      <Box role="status" aria-live="polite" aria-atomic="true" sx={{ mb: 1 }}>
        {authorization ? (
          <>
            <Typography variant="body2">{t('Enter this code on GitHub to connect:')}</Typography>
            <Typography
              component="code"
              sx={{
                display: 'block',
                fontFamily: 'monospace',
                fontSize: '1.25rem',
                fontWeight: 700,
                letterSpacing: '.08em',
                my: 1,
              }}
            >
              {authorization.userCode}
            </Typography>
          </>
        ) : (
          <Typography variant="body2">{t('Requesting a GitHub authorization code...')}</Typography>
        )}
      </Box>
      {authorization && (
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mb: 1 }}>
          {t('Code expires at {{time}}.', {
            time: new Date(authorization.expiresAt).toLocaleTimeString(),
          })}
        </Typography>
      )}
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t('The account signed in to GitHub in your browser will be connected.')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          size="small"
          disabled={!authorization}
          onClick={() => {
            if (authorization) openExternalUrl(authorization.verificationUri);
          }}
        >
          {t('Open GitHub')}
        </Button>
        <Button size="small" onClick={onCancel}>
          {t('Cancel')}
        </Button>
      </Box>
    </Box>
  );
}
