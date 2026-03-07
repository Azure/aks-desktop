// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
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
  const { githubPipelines } = usePreviewFeatures();
  const cluster = project.clusters?.[0] ?? '';
  const namespace = project.namespaces?.[0] ?? '';
  const { octokit, authState, startOAuth } = useGitHubAuthContext();
  const pipelineStatus = usePipelineStatus(cluster, namespace);
  const { runs, loading, error } = usePipelineRuns(octokit, pipelineStatus.repos);

  if (!githubPipelines) return null;

  return (
    <Box
      sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 0, '&:last-child': { pb: 0 } }}
    >
      <Typography variant="h6" sx={{ mb: 2 }}>
        Pipeline
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
            Set up your pipeline
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 280 }}>
            Set up a CI/CD pipeline to automate your deployments and streamline your workflow
          </Typography>
          <Button
            variant="contained"
            size="small"
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_CONFIGURE_PIPELINE_EVENT))}
            sx={{ textTransform: 'none' }}
          >
            Configure Pipeline
          </Button>
        </Box>
      )}

      {pipelineStatus.isConfigured && !authState.isAuthenticated && !authState.isRestoring && (
        <Box>
          {authState.isAuthorizingBrowser ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={14} />
              <Typography variant="body2" color="text.secondary">
                Waiting for browser authorization...
              </Typography>
            </Box>
          ) : (
            <Typography
              variant="body2"
              color="primary"
              sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
              onClick={startOAuth}
            >
              Sign in to GitHub to view pipeline runs.
            </Typography>
          )}
        </Box>
      )}

      {pipelineStatus.isConfigured && authState.isRestoring && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
          <CircularProgress size={14} />
          <Typography variant="body2" color="text.secondary">
            Connecting...
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

          {!loading && !error && runs.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No pipeline runs yet.
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
                <Tooltip title="View on GitHub">
                  <IconButton
                    size="small"
                    aria-label="View run on GitHub"
                    onClick={() => openExternalUrl(run.url)}
                  >
                    <Box component={Icon} icon="mdi:open-in-new" sx={{ fontSize: 16 }} />
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
