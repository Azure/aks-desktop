// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import type { Octokit } from '@octokit/rest';
import React, { useEffect, useState } from 'react';
import type { GitHubAuthState, GitHubRepo } from '../../../types/github';
import { openExternalUrl } from '../../../utils/shared/openExternalUrl';
import { GitHubDeviceCodePrompt } from './GitHubDeviceCodePrompt';
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
  onCancelOAuth: () => void;
  onAbortOAuth: () => void;
  onDisconnect: () => void;
  octokit: Octokit | null;
  selectedRepo: GitHubRepo | null;
  onRepoSelect: (repo: GitHubRepo) => void;
  appInstallNeeded?: boolean;
  appInstallUrl?: string | null;
}

export function ConnectSourceStep({
  authState,
  onStartOAuth,
  onCancelOAuth,
  onAbortOAuth,
  onDisconnect,
  octokit,
  selectedRepo,
  onRepoSelect,
  appInstallNeeded,
  appInstallUrl,
}: ConnectSourceStepProps) {
  const { t } = useTranslation();
  const { isAuthorizingBrowser, username, error } = authState;
  useEffect(() => () => onCancelOAuth(), [onCancelOAuth]);
  const isAuthenticated = authState.isAuthenticated;
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

      {authState.isDisconnecting ? (
        <Typography role="status" variant="body2" sx={{ mb: 2 }}>
          {t('Removing saved GitHub credentials...')}
        </Typography>
      ) : authState.disconnectError ? (
        <Box sx={{ mb: 2 }}>
          <Alert severity="warning" sx={{ mb: 1 }}>
            {t('Saved GitHub credentials may remain. Retry disconnect before connecting again.')}
          </Alert>
          <Button variant="outlined" onClick={onDisconnect}>
            {t('Retry disconnect')}
          </Button>
        </Box>
      ) : isAuthenticated ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <Box
            component={Icon}
            icon="mdi:check-circle"
            sx={{ color: 'success.main', fontSize: 18 }}
          />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t("Connected to '{{username}}'.", { username })}
          </Typography>
          <Button size="small" onClick={onDisconnect}>
            {t('Disconnect GitHub')}
          </Button>
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
            <GitHubDeviceCodePrompt
              authorization={authState.deviceAuthorization}
              onCancel={onAbortOAuth}
            />
          ) : (
            <Button
              variant="outlined"
              size="small"
              disabled={authState.isRestoring}
              startIcon={<Icon icon="mdi:github" aria-hidden="true" />}
              onClick={onStartOAuth}
              sx={{ textTransform: 'none', mb: 2 }}
            >
              {t('Connect')}
            </Button>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {t(error)}
            </Alert>
          )}
        </>
      )}

      {isAuthenticated && error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t(error)}
        </Alert>
      )}

      {/* Repo Selector - shown only for the current usable session. */}
      {isAuthenticated && octokit && !authState.isDisconnecting && !authState.disconnectError && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
            {t('Select repository')}
          </Typography>
          <RepoSelector
            octokit={octokit}
            sessionVersion={authState.sessionVersion}
            selectedRepo={selectedRepo}
            onRepoSelect={onRepoSelect}
          />

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
