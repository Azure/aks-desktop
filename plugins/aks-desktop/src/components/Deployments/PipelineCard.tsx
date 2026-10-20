// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import React, { useEffect } from 'react';
import { usePreviewFeatures } from '../../hooks/usePreviewFeatures';
import type { ProjectDefinition } from '../../types/project';
import { openExternalUrl } from '../../utils/shared/openExternalUrl';
import { usePipelineStatus } from '../DeployTab/hooks/usePipelineStatus';
import { OPEN_CONFIGURE_PIPELINE_EVENT } from '../GitHubPipeline/constants';
import { useGitHubAuthContext } from '../GitHubPipeline/GitHubAuthContext';
import { getRunStatusIcon, getRunStatusLabel } from '../GitHubPipeline/utils/statusDisplay';
import { usePipelineRuns } from './hooks/usePipelineRuns';

interface PipelineCardProps {
  project: ProjectDefinition;
}

function PipelineCard({ project }: PipelineCardProps) {
  const { t } = useTranslation();
  const { githubPipelines } = usePreviewFeatures();
  const cluster = project.clusters?.[0] ?? '';
  const namespace = project.namespaces?.[0] ?? '';
  const { octokit, authState, startOAuth, cancelOAuth, abortOAuth, reset } = useGitHubAuthContext();
  const pipelineStatus = usePipelineStatus(cluster, namespace);
  const { runs, loading, error } = usePipelineRuns(
    octokit,
    pipelineStatus.repos,
    authState.sessionVersion
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: Losing the visible card must cancel approval even if its provider survives.
  useEffect(() => () => cancelOAuth(), [cancelOAuth, pipelineStatus.isConfigured]);

  if (!githubPipelines) return null;

  return (
    <Box
      sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 0, '&:last-child': { pb: 0 } }}
    >
      <Typography variant="h6" sx={{ mb: 2 }}>
        {t('Pipeline')}
      </Typography>

      {!pipelineStatus.isConfigured && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            py: 4,
            textAlign: 'center',
          }}
        >
          <Box
            component={Icon}
            icon="mdi:pipe"
            sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }}
          />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t('Set up your pipeline')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 280 }}>
            {t('Set up a CI/CD pipeline to automate your deployments and streamline your workflow')}
          </Typography>
          <Button
            variant="contained"
            size="small"
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_CONFIGURE_PIPELINE_EVENT))}
            sx={{ textTransform: 'none' }}
          >
            {t('Configure Pipeline')}
          </Button>
        </Box>
      )}

      {pipelineStatus.isConfigured && !authState.isAuthenticated && !authState.isRestoring && (
        <Box>
          {authState.isDisconnecting ? (
            <Typography role="status">{t('Removing saved GitHub credentials...')}</Typography>
          ) : authState.disconnectError ? (
            <>
              <Alert severity="warning">
                {t(
                  'Saved GitHub credentials may remain. Retry disconnect before connecting again.'
                )}
              </Alert>
              <Button onClick={() => void reset()}>{t('Retry disconnect')}</Button>
            </>
          ) : (
            <>
              {authState.error && <Alert severity="error">{t(authState.error)}</Alert>}
              {authState.isAuthorizingBrowser && (
                <Box role="status" aria-live="polite" aria-atomic="true" sx={{ mb: 1 }}>
                  <Typography variant="body2">
                    {authState.deviceAuthorization
                      ? t('Enter this code on GitHub to connect:')
                      : t('Requesting a GitHub authorization code...')}
                  </Typography>
                  {authState.deviceAuthorization && (
                    <Typography component="code" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                      {authState.deviceAuthorization.userCode}
                    </Typography>
                  )}
                </Box>
              )}
              {authState.isAuthorizingBrowser && (
                <Button
                  size="small"
                  disabled={!authState.deviceAuthorization}
                  onClick={() => {
                    if (authState.deviceAuthorization)
                      openExternalUrl(authState.deviceAuthorization.verificationUri);
                  }}
                >
                  {t('Open GitHub')}
                </Button>
              )}
              <Button
                size="small"
                onClick={() => {
                  if (authState.isAuthorizingBrowser) abortOAuth();
                  else void startOAuth();
                }}
              >
                {authState.isAuthorizingBrowser ? t('Cancel') : t('Connect GitHub')}
              </Button>
            </>
          )}
        </Box>
      )}

      {pipelineStatus.isConfigured && authState.isRestoring && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
          <CircularProgress size={14} />
          <Typography variant="body2" color="text.secondary">
            {t('Connecting...')}
          </Typography>
        </Box>
      )}

      {pipelineStatus.isConfigured && authState.isAuthenticated && (
        <>
          {pipelineStatus.repos.map(r => (
            <Typography
              key={`${r.owner}/${r.repo}`}
              variant="caption"
              color="text.secondary"
              sx={{ mb: 0.5 }}
            >
              {r.owner}/{r.repo}
            </Typography>
          ))}

          {loading && runs.length === 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={20} />
            </Box>
          )}

          {error && (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          )}

          <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>
            {!loading && !error && runs.length === 0 ? t('No pipeline runs yet.') : ''}
          </Box>

          {!loading && !error && runs.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t('No pipeline runs yet.')}
            </Typography>
          )}

          {runs.map(run => {
            const { icon, color } = getRunStatusIcon(run.status, run.conclusion);
            return (
              <Box
                key={run.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  py: 0.75,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
                  <Box component={Icon} icon={icon} sx={{ color, fontSize: 18, flexShrink: 0 }} />
                  <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                    {run.name || `Run #${run.id}`}
                  </Typography>
                  <Chip
                    label={getRunStatusLabel(run.status, run.conclusion)}
                    size="small"
                    variant="outlined"
                    sx={{ textTransform: 'capitalize' }}
                  />
                </Box>
                <Tooltip title={t('View on GitHub')}>
                  <IconButton
                    size="small"
                    aria-label={t('View run on GitHub')}
                    onClick={() => openExternalUrl(run.url)}
                  >
                    <Box
                      component={Icon}
                      icon="mdi:open-in-new"
                      sx={{ fontSize: 16 }}
                      aria-hidden
                    />
                  </IconButton>
                </Tooltip>
              </Box>
            );
          })}
        </>
      )}
    </Box>
  );
}

export default PipelineCard;
