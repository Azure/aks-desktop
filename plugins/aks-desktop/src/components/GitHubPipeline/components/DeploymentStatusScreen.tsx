// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import React, { Fragment } from 'react';
import type { WorkflowRunConclusion, WorkflowRunStatus } from '../../../types/github';
import { getRelativeTime } from '../../../utils/shared/formatTime';
import { CopyButton } from '../../shared/CopyButton';
import type { PipelineState } from '../types';
import {
  getPodStatusColor,
  getWorkflowBadgeColor,
  getWorkflowBadgeLabel,
} from '../utils/statusDisplay';

interface DeploymentStatusScreenProps {
  pipelineState: PipelineState;
  workflowStatus: {
    status: WorkflowRunStatus | null;
    conclusion: WorkflowRunConclusion;
    url: string | null;
  };
  deploymentHealth: {
    ready: boolean;
    podStatuses: Array<{ name: string; status: string; restarts: number }>;
    serviceEndpoint: string | null;
  };
  /** Error from deployment health monitoring. */
  deploymentHealthError?: string | null;
  onRedeploy: () => void;
  onOpenGitHubRun: () => void;
}

interface StageInfo {
  label: string;
  icon: string;
  color: string;
  completed: boolean;
  active: boolean;
}

function getPipelineStageInfo(
  t: (key: string) => string,
  succeeded: boolean,
  failed: boolean,
  running: boolean
): { label: string; icon: string; color: string } {
  if (failed) return { label: t('Pipeline Failed'), icon: 'mdi:close-circle', color: 'error.main' };
  if (succeeded)
    return { label: t('Pipeline Succeeded'), icon: 'mdi:check-circle', color: 'success.main' };
  if (running)
    return { label: t('Pipeline Running'), icon: 'mdi:progress-clock', color: 'info.main' };
  return { label: t('Pipeline Running'), icon: 'mdi:progress-clock', color: 'text.disabled' };
}

const getStages = (
  t: (key: string) => string,
  workflowStatus: DeploymentStatusScreenProps['workflowStatus'],
  deploymentReady: boolean
): StageInfo[] => {
  const pipelineCompleted = workflowStatus.status === 'completed';
  const pipelineSucceeded = pipelineCompleted && workflowStatus.conclusion === 'success';
  const pipelineFailed = pipelineCompleted && workflowStatus.conclusion !== 'success';
  const pipelineRunning =
    workflowStatus.status === 'in_progress' || workflowStatus.status === 'queued';

  const pipelineStage = getPipelineStageInfo(t, pipelineSucceeded, pipelineFailed, pipelineRunning);

  return [
    {
      label: t('PR Created'),
      icon: 'mdi:check-circle',
      color: 'success.main',
      completed: true,
      active: false,
    },
    {
      label: t('PR Merged'),
      icon: 'mdi:check-circle',
      color: 'success.main',
      completed: true,
      active: false,
    },
    {
      label: pipelineStage.label,
      icon: pipelineStage.icon,
      color: pipelineStage.color,
      completed: pipelineCompleted,
      active: pipelineRunning,
    },
    {
      label: deploymentReady ? t('Deployment Ready') : t('Deployment Pending'),
      icon: deploymentReady ? 'mdi:check-circle' : 'mdi:timer-sand',
      color: deploymentReady ? 'success.main' : pipelineSucceeded ? 'info.main' : 'text.disabled',
      completed: deploymentReady,
      active: pipelineSucceeded && !deploymentReady,
    },
  ];
};

export function DeploymentStatusScreen({
  pipelineState,
  workflowStatus,
  deploymentHealth,
  deploymentHealthError,
  onRedeploy,
  onOpenGitHubRun,
}: DeploymentStatusScreenProps) {
  const { t } = useTranslation();
  const stages = getStages(t, workflowStatus, deploymentHealth.ready);
  const namespace = pipelineState.config?.namespace ?? '';
  const pipelineFailed =
    workflowStatus.status === 'completed' && workflowStatus.conclusion !== 'success';

  const readyPods = deploymentHealth.podStatuses.filter(p => p.status === 'Running').length;
  const totalPods = deploymentHealth.podStatuses.length;
  const lastUpdated = pipelineState.updatedAt ? getRelativeTime(pipelineState.updatedAt) : null;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 4 }}>
        {stages.map((stage, index) => (
          <Fragment key={stage.label}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mx: 1 }}>
              <Box component={Icon} icon={stage.icon} sx={{ fontSize: 28, color: stage.color }} />
              <Typography
                variant="caption"
                sx={{
                  mt: 0.5,
                  color: stage.completed || stage.active ? 'text.primary' : 'text.disabled',
                  fontWeight: stage.active ? 600 : 400,
                  textAlign: 'center',
                  maxWidth: 80,
                }}
              >
                {stage.label}
              </Typography>
            </Box>
            {index < stages.length - 1 && (
              <Box
                sx={{
                  width: 32,
                  height: 2,
                  bgcolor: stage.completed ? 'success.main' : 'divider',
                  mt: -2,
                }}
              />
            )}
          </Fragment>
        ))}
      </Box>

      {namespace && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', mr: 1 }}>
            {t('Namespace')}:
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
            {namespace}
          </Typography>
          <CopyButton text={namespace} />
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', mr: 1 }}>
          {t('Pipeline')}:
        </Typography>
        <Chip
          label={getWorkflowBadgeLabel(workflowStatus.status, workflowStatus.conclusion)}
          color={getWorkflowBadgeColor(workflowStatus.status, workflowStatus.conclusion)}
          size="small"
          sx={{ fontWeight: 600 }}
        />
        {workflowStatus.url && (
          <Tooltip title={t('View on GitHub')}>
            <IconButton
              size="small"
              onClick={onOpenGitHubRun}
              sx={{ ml: 0.5 }}
              aria-label={t('View workflow run on GitHub')}
            >
              <Icon icon="mdi:open-in-new" width={16} aria-hidden="true" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {pipelineFailed && (
        <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>
          {workflowStatus.conclusion
            ? t(
                'The deployment pipeline failed ({{conclusion}}). Check the GitHub Actions logs for details.',
                { conclusion: workflowStatus.conclusion }
              )
            : t('The deployment pipeline failed. Check the GitHub Actions logs for details.')}
        </Alert>
      )}

      {deploymentHealthError && (
        <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>
          {deploymentHealthError}
        </Alert>
      )}

      {deploymentHealth.podStatuses.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
            {t('Pod Status')}
          </Typography>
          {deploymentHealth.podStatuses.map(pod => (
            <Box
              key={pod.name}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                mb: 0.5,
                px: 1,
                py: 0.5,
                borderRadius: 1,
                bgcolor: 'action.hover',
              }}
            >
              <Typography
                variant="body2"
                sx={{ fontFamily: 'monospace', fontSize: 12, flex: 1, minWidth: 0, mr: 1 }}
                noWrap
              >
                {pod.name}
              </Typography>
              <Chip
                label={pod.status}
                color={getPodStatusColor(pod.status)}
                size="small"
                sx={{ fontSize: 11, height: 22, mr: 1 }}
              />
              {pod.restarts > 0 && (
                <Typography variant="caption" sx={{ color: 'warning.main' }}>
                  {t('{{count}} restart', { count: pod.restarts })}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}

      {deploymentHealth.serviceEndpoint && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', mr: 1 }}>
            {t('Service Endpoint')}:
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
            {deploymentHealth.serviceEndpoint}
          </Typography>
          <CopyButton text={deploymentHealth.serviceEndpoint} />
        </Box>
      )}

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 3,
          py: 1,
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {totalPods > 0
            ? totalPods === 1
              ? t('{{ready}}/{{total}} pod ready', { ready: readyPods, total: totalPods })
              : t('{{ready}}/{{total}} pods ready', { ready: readyPods, total: totalPods })
            : t('No pods found')}
        </Typography>
        {lastUpdated && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('Last updated')}: {lastUpdated}
          </Typography>
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
        {workflowStatus.url && (
          <Button
            variant="contained"
            color="primary"
            onClick={onOpenGitHubRun}
            startIcon={<Icon icon="mdi:open-in-new" aria-hidden="true" />}
            sx={{ textTransform: 'none', fontSize: 14 }}
          >
            {t('View on GitHub')}
          </Button>
        )}
        <Button
          variant="outlined"
          onClick={onRedeploy}
          startIcon={<Icon icon="mdi:refresh" aria-hidden="true" />}
          sx={{ textTransform: 'none', fontSize: 14 }}
        >
          {t('Redeploy')}
        </Button>
      </Box>
    </Box>
  );
}
