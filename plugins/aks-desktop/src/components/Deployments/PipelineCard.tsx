// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Chip, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import React from 'react';
import type { WorkflowRunConclusion, WorkflowRunStatus } from '../../types/github';
import { usePipelineStatus } from '../DeployTab/hooks/usePipelineStatus';
import { useGitHubAuth } from '../GitHubPipeline/hooks/useGitHubAuth';
import { usePipelineRuns } from './hooks/usePipelineRuns';

interface PipelineCardProps {
  project: { id: string; namespaces: string[]; clusters: string[] };
}

function getStatusIcon(status: WorkflowRunStatus | null, conclusion: WorkflowRunConclusion) {
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
        return { icon: 'mdi:check-circle', color: 'success.main' };
      case 'failure':
        return { icon: 'mdi:close-circle', color: 'error.main' };
      case 'cancelled':
        return { icon: 'mdi:cancel', color: 'text.secondary' };
      default:
        return { icon: 'mdi:help-circle', color: 'text.secondary' };
    }
  }
  if (status === 'in_progress') {
    return { icon: 'mdi:progress-clock', color: 'info.main' };
  }
  if (status === 'queued' || status === 'waiting') {
    return { icon: 'mdi:clock-outline', color: 'warning.main' };
  }
  return { icon: 'mdi:help-circle', color: 'text.secondary' };
}

function getStatusLabel(status: WorkflowRunStatus | null, conclusion: WorkflowRunConclusion) {
  if (status === 'completed') return conclusion ?? 'completed';
  return status ?? 'unknown';
}

// eslint-disable-next-line no-unused-vars
function PipelineCard(_props: PipelineCardProps) {
  const { octokit, authState } = useGitHubAuth();
  const pipelineStatus = usePipelineStatus();
  const { runs, loading, error } = usePipelineRuns(
    octokit,
    pipelineStatus.repo?.owner ?? null,
    pipelineStatus.repo?.repo ?? null
  );

  return (
    <Box
      sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 0, '&:last-child': { pb: 0 } }}
    >
      <Typography variant="h6" sx={{ mb: 2 }}>
        Pipeline
      </Typography>

      {!pipelineStatus.isConfigured && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Icon icon="mdi:information-outline" style={{ fontSize: 18, color: '#999' }} />
          <Typography variant="body2" color="text.secondary">
            No pipeline configured. Use "Configure Pipeline" to set up CI/CD.
          </Typography>
        </Box>
      )}

      {pipelineStatus.isConfigured && !authState.isAuthenticated && !authState.isRestoring && (
        <Typography variant="body2" color="text.secondary">
          Sign in to GitHub to view pipeline runs.
        </Typography>
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
          {pipelineStatus.repo && (
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
              {pipelineStatus.repo.owner}/{pipelineStatus.repo.repo}
            </Typography>
          )}

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
            const { icon, color } = getStatusIcon(run.status, run.conclusion);
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
                    label={getStatusLabel(run.status, run.conclusion)}
                    size="small"
                    variant="outlined"
                    sx={{ textTransform: 'capitalize' }}
                  />
                </Box>
                <Tooltip title="View on GitHub">
                  <IconButton
                    size="small"
                    aria-label="View run on GitHub"
                    onClick={() => window.open(run.url, '_blank')}
                  >
                    <Icon icon="mdi:open-in-new" style={{ fontSize: 16 }} />
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
