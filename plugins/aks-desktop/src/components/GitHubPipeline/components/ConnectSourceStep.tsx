// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import type { Octokit } from '@octokit/rest';
import React, { useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import { openExternalUrl } from '../../../utils/shared/openExternalUrl';
import type { GitHubAuthState } from '../types';
import { RepoSelector } from './RepoSelector';

interface ConnectSourceStepProps {
  authState: GitHubAuthState;
  octokit: Octokit | null;
  selectedRepo: GitHubRepo | null;
  onRepoSelect: (repo: GitHubRepo) => void;
  appInstallNeeded?: boolean;
  appInstallUrl?: string | null;
}

export function ConnectSourceStep({
  authState,
  octokit,
  selectedRepo,
  onRepoSelect,
  appInstallNeeded,
  appInstallUrl,
}: ConnectSourceStepProps) {
  const { t } = useTranslation();
  const { username, error, isAuthenticated } = authState;

  return (
    <Box sx={{ maxWidth: 600 }}>
      {/* GitHub Auth Section */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Icon icon="mdi:github" width={22} height={22} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t('Connect to GitHub')}
        </Typography>
      </Box>

      {isAuthenticated ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <Box
            component={Icon}
            icon="mdi:check-circle"
            sx={{ color: 'success.main', fontSize: 18 }}
          />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t("Connected to '{{username}}'.", { username })}
          </Typography>
        </Box>
      ) : (
        <>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {t('Connect GitHub from the project header to continue.')}
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
        </>
      )}

      {/* Repo Selector - shown after auth */}
      {isAuthenticated && octokit && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
            {t('Select repository')}
          </Typography>
          <RepoSelector octokit={octokit} selectedRepo={selectedRepo} onRepoSelect={onRepoSelect} />

          {/* App install warning - shown inline below repo selector */}
          {appInstallNeeded && selectedRepo && (
            <AppInstallAlert selectedRepo={selectedRepo} appInstallUrl={appInstallUrl} />
          )}
        </>
      )}
    </Box>
  );
}

function AppInstallAlert({
  selectedRepo,
  appInstallUrl,
}: {
  selectedRepo: GitHubRepo;
  appInstallUrl?: string | null;
}) {
  const [installClicked, setInstallClicked] = useState(false);
  const { t } = useTranslation();

  const handleInstallClick = () => {
    if (appInstallUrl) {
      openExternalUrl(appInstallUrl);
      setInstallClicked(true);
    }
  };

  const repoName = `${selectedRepo.owner}/${selectedRepo.repo}`;

  return (
    <Alert severity={installClicked ? 'info' : 'warning'} sx={{ mt: 2 }}>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {installClicked
          ? t(
              'Complete the installation in your browser. This will update automatically once the app is installed on {{repoName}}.',
              { repoName }
            )
          : t('The AKS Desktop GitHub App must be installed on {{repoName}} to continue.', {
              repoName,
            })}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {appInstallUrl && (
          <Button
            size="small"
            variant={installClicked ? 'text' : 'outlined'}
            onClick={handleInstallClick}
            sx={{ textTransform: 'none' }}
          >
            {installClicked ? t('Reopen install page') : t('Install GitHub App')}
          </Button>
        )}
        {installClicked && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
            <CircularProgress size={12} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t('Checking...')}
            </Typography>
          </Box>
        )}
      </Box>
    </Alert>
  );
}
