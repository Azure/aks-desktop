// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import type { WorkflowRunConclusion, WorkflowRunStatus } from '../../../types/github';
import type { PipelineState } from '../types';

interface DeploymentStatusScreenProps {
  /** Current pipeline state. */
  pipelineState: PipelineState;
  /** Latest workflow run status from polling. */
  workflowStatus: {
    status: WorkflowRunStatus | null;
    conclusion: WorkflowRunConclusion;
    url: string | null;
  };
  /** Kubernetes deployment health from cluster polling. */
  deploymentHealth: {
    ready: boolean;
    podStatuses: Array<{ name: string; status: string; restarts: number }>;
    serviceEndpoint: string | null;
  };
  /** Re-dispatches the workflow. */
  onRedeploy: () => void;
  /** Opens GitHub Actions run in browser. */
  onOpenGitHubRun: () => void;
}

// --- Pipeline stage helpers ---

interface StageInfo {
  label: string;
  icon: string;
  color: string;
  completed: boolean;
  active: boolean;
}

const getStages = (
  workflowStatus: DeploymentStatusScreenProps['workflowStatus'],
  deploymentReady: boolean
): StageInfo[] => {
  const pipelineCompleted = workflowStatus.status === 'completed';
  const pipelineSucceeded = pipelineCompleted && workflowStatus.conclusion === 'success';
  const pipelineFailed = pipelineCompleted && workflowStatus.conclusion !== 'success';
  const pipelineRunning =
    workflowStatus.status === 'in_progress' || workflowStatus.status === 'queued';

  return [
    {
      label: 'PR Created',
      icon: 'mdi:check-circle',
      color: 'success.main',
      completed: true,
      active: false,
    },
    {
      label: 'PR Merged',
      icon: 'mdi:check-circle',
      color: 'success.main',
      completed: true,
      active: false,
    },
    {
      label: pipelineFailed
        ? 'Pipeline Failed'
        : pipelineSucceeded
        ? 'Pipeline Succeeded'
        : 'Pipeline Running',
      icon: pipelineFailed
        ? 'mdi:close-circle'
        : pipelineSucceeded
        ? 'mdi:check-circle'
        : 'mdi:progress-clock',
      color: pipelineFailed
        ? 'error.main'
        : pipelineSucceeded
        ? 'success.main'
        : pipelineRunning
        ? 'info.main'
        : 'text.disabled',
      completed: pipelineCompleted,
      active: pipelineRunning,
    },
    {
      label: deploymentReady ? 'Deployment Ready' : 'Deployment Pending',
      icon: deploymentReady ? 'mdi:check-circle' : 'mdi:timer-sand',
      color: deploymentReady ? 'success.main' : pipelineSucceeded ? 'info.main' : 'text.disabled',
      completed: deploymentReady,
      active: pipelineSucceeded && !deploymentReady,
    },
  ];
};

// --- Workflow status badge helpers ---

const getWorkflowBadgeLabel = (
  status: WorkflowRunStatus | null,
  conclusion: WorkflowRunConclusion
): string => {
  if (status === 'completed') {
    if (conclusion === 'success') return 'Succeeded';
    if (conclusion === 'failure') return 'Failed';
    if (conclusion === 'cancelled') return 'Cancelled';
    if (conclusion === 'timed_out') return 'Timed Out';
    return 'Completed';
  }
  if (status === 'in_progress') return 'Running';
  if (status === 'queued' || status === 'waiting') return 'Queued';
  return 'Unknown';
};

const getWorkflowBadgeColor = (
  status: WorkflowRunStatus | null,
  conclusion: WorkflowRunConclusion
): 'success' | 'error' | 'info' | 'warning' | 'default' => {
  if (status === 'completed') {
    if (conclusion === 'success') return 'success';
    if (conclusion === 'failure') return 'error';
    return 'warning';
  }
  if (status === 'in_progress') return 'info';
  return 'default';
};

// --- Pod status chip helpers ---

const getPodStatusColor = (
  status: string
): 'success' | 'error' | 'warning' | 'info' | 'default' => {
  if (status === 'Running') return 'success';
  if (status === 'Pending' || status === 'ContainerCreating') return 'info';
  if (status === 'CrashLoopBackOff' || status === 'Error' || status === 'Failed') return 'error';
  if (status === 'Terminating' || status === 'OOMKilled') return 'warning';
  return 'default';
};

// --- Relative time helper ---

function getRelativeTime(isoString: string): string {
  const deltaMs = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// --- Copy to clipboard ---

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard API may be unavailable in some Electron contexts
      });
  };

  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy'}>
      <IconButton size="small" onClick={handleCopy} sx={{ ml: 0.5 }}>
        <Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={16} />
      </IconButton>
    </Tooltip>
  );
};

// --- Main component ---

export const DeploymentStatusScreen: React.FC<DeploymentStatusScreenProps> = ({
  pipelineState,
  workflowStatus,
  deploymentHealth,
  onRedeploy,
  onOpenGitHubRun,
}) => {
  const stages = getStages(workflowStatus, deploymentHealth.ready);
  const namespace = pipelineState.config?.namespace ?? '';
  const pipelineFailed =
    workflowStatus.status === 'completed' && workflowStatus.conclusion !== 'success';

  const readyPods = deploymentHealth.podStatuses.filter(p => p.status === 'Running').length;
  const totalPods = deploymentHealth.podStatuses.length;
  const lastUpdated = pipelineState.updatedAt ? getRelativeTime(pipelineState.updatedAt) : null;

  return (
    <Card sx={{ maxWidth: 600, width: '100%', p: 4 }}>
      <CardContent>
        {/* Pipeline Stage Indicator */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 4 }}>
          {stages.map((stage, index) => (
            <React.Fragment key={stage.label}>
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
            </React.Fragment>
          ))}
        </Box>

        {/* Namespace */}
        {namespace && (
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', mr: 1 }}>
              Namespace:
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
              {namespace}
            </Typography>
            <CopyButton text={namespace} />
          </Box>
        )}

        {/* GitHub Pipeline Status */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', mr: 1 }}>
            Pipeline:
          </Typography>
          <Chip
            label={getWorkflowBadgeLabel(workflowStatus.status, workflowStatus.conclusion)}
            color={getWorkflowBadgeColor(workflowStatus.status, workflowStatus.conclusion)}
            size="small"
            sx={{ fontWeight: 600 }}
          />
          {workflowStatus.url && (
            <Tooltip title="View on GitHub">
              <IconButton size="small" onClick={onOpenGitHubRun} sx={{ ml: 0.5 }}>
                <Icon icon="mdi:open-in-new" width={16} />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {/* Pipeline failure alert */}
        {pipelineFailed && (
          <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>
            The deployment pipeline failed
            {workflowStatus.conclusion ? ` (${workflowStatus.conclusion})` : ''}. Check the GitHub
            Actions logs for details.
          </Alert>
        )}

        {/* Pod Status */}
        {deploymentHealth.podStatuses.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
              Pod Status
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
                    {pod.restarts} restart{pod.restarts !== 1 ? 's' : ''}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        )}

        {/* Service Endpoint */}
        {deploymentHealth.serviceEndpoint && (
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', mr: 1 }}>
              Service Endpoint:
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
              {deploymentHealth.serviceEndpoint}
            </Typography>
            {deploymentHealth.serviceEndpoint !== '<pending>' && (
              <CopyButton text={deploymentHealth.serviceEndpoint} />
            )}
          </Box>
        )}

        {/* Health Summary + Last Updated */}
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
              ? `${readyPods}/${totalPods} pod${totalPods !== 1 ? 's' : ''} ready`
              : 'No pods found'}
          </Typography>
          {lastUpdated && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Last updated: {lastUpdated}
            </Typography>
          )}
        </Box>

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
          {workflowStatus.url && (
            <Button
              variant="contained"
              color="primary"
              onClick={onOpenGitHubRun}
              startIcon={<Icon icon="mdi:open-in-new" />}
              sx={{ textTransform: 'none', fontSize: 14 }}
            >
              View on GitHub
            </Button>
          )}
          <Button
            variant="outlined"
            onClick={onRedeploy}
            startIcon={<Icon icon="mdi:refresh" />}
            sx={{ textTransform: 'none', fontSize: 14 }}
          >
            Redeploy
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
};
