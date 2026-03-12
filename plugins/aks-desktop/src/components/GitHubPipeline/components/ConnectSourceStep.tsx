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

function getPermissions(t: (key: string) => string) {
  return [
    { id: 'contents', name: t('Contents'), purpose: t('Push agent config files') },
    {
      id: 'workflows',
      name: t('Workflows'),
      purpose: t('Create setup workflow in .github/workflows/'),
    },
    { id: 'pull-requests', name: t('Pull requests'), purpose: t('Create deployment PRs') },
    { id: 'issues', name: t('Issues'), purpose: t('Track agent progress') },
    { id: 'actions', name: t('Actions'), purpose: t('Run deployment workflows') },
  ];
}

interface ConnectSourceStepProps {
  authState: GitHubAuthState;
  onStartOAuth: () => void;
  octokit: Octokit | null;
  selectedRepo: GitHubRepo | null;
  onRepoSelect: (repo: GitHubRepo) => void;
  appInstallNeeded?: boolean;
  appInstallUrl?: string | null;
  /** Override from the wizard: auth was completed (state machine advanced past auth). */
  authCompleted?: boolean;
}

export function ConnectSourceStep({
  authState,
  onStartOAuth,
  octokit,
  selectedRepo,
  onRepoSelect,
  appInstallNeeded,
  appInstallUrl,
  authCompleted,
}: ConnectSourceStepProps) {
  const { t } = useTranslation();
  const { isAuthorizingBrowser, username, error } = authState;
  const isAuthenticated = authCompleted || authState.isAuthenticated;
  const permissions = getPermissions(t);

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
            {t('Authorize AKS Desktop to create deployment pipelines in your repository.')}
          </Typography>

          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
            {t('Required Permissions')}
          </Typography>
          <Box sx={{ mb: 2 }}>
            {permissions.map(perm => (
              <Box key={perm.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Box
                  component={Icon}
                  icon="mdi:check-circle-outline"
                  sx={{ fontSize: 16, color: 'text.secondary' }}
                />
                <Typography variant="body2">
                  <strong>{perm.name}</strong>
                  {perm.purpose && ` - ${perm.purpose}`}
                </Typography>
              </Box>
            ))}
          </Box>

          {isAuthorizingBrowser ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Box
                component={Icon}
                icon="mdi:open-in-new"
                sx={{ fontSize: 16, color: 'primary.main' }}
              />
              <Typography variant="body2" sx={{ color: 'primary.main' }}>
                {t('Complete authorization on your browser screen')}
              </Typography>
            </Box>
          ) : (
            <Button
              variant="outlined"
              size="small"
              startIcon={<Icon icon="mdi:open-in-new" aria-hidden="true" />}
              onClick={onStartOAuth}
              sx={{ textTransform: 'none', mb: 2 }}
            >
              {t('Connect')}
            </Button>
          )}

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
