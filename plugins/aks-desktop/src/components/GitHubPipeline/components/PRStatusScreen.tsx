// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import type { AgentPhase } from '../hooks/useAgentWorkflowProgress';
import type { PipelineState } from '../types';
import { getCheckColor, getCheckIcon } from '../utils/statusDisplay';
import type { StepStatus } from './StepStatusIcon';
import { StepStatusIcon } from './StepStatusIcon';

type PRPhase = 'setup' | 'agent-pending' | 'agent-created';

interface PRStatusScreenProps {
  pipelineState: PipelineState;
  prPhase: PRPhase;
  prStatus: {
    state: string;
    merged: boolean;
    mergeable: boolean | null;
  } | null;
  isTimedOut: boolean;
  statusChecks: Array<{ name: string; status: string; conclusion: string | null }> | null;
  onReviewInGitHub: () => void;
  agentProgress?: { phases: AgentPhase[]; agentStartedAt: string | null };
}

const getHeaderIcon = (phase: PRPhase, merged: boolean): string => {
  if (merged) return 'mdi:check-circle';
  if (phase === 'agent-pending') return 'mdi:robot-outline';
  return 'mdi:source-pull';
};

const getHeaderColor = (phase: PRPhase, merged: boolean): string => {
  if (merged) return 'success.main';
  if (phase === 'agent-pending') return 'info.main';
  return 'primary.main';
};

const getTitle = (t: (key: string) => string, phase: PRPhase, merged: boolean): string => {
  if (phase === 'setup') {
    return merged ? t('Setup PR Merged') : t('Setup PR Created');
  }
  if (phase === 'agent-pending') {
    return t('Agent is Working');
  }
  return merged ? t('Deployment PR Merged') : t('Deployment PR Ready');
};

const getDescription = (t: (key: string) => string, phase: PRPhase, merged: boolean): string => {
  if (phase === 'setup' && !merged) {
    return t(
      'Review and merge the setup PR to enable the Copilot agent. After merging, the agent will analyze your repo and create a deployment PR.'
    );
  }
  if (phase === 'setup' && merged) {
    return t('The setup PR has been merged. The Copilot agent is now being triggered...');
  }
  if (phase === 'agent-pending') {
    return t(
      'The Copilot Coding Agent is analyzing your repository and generating a deployment PR with Dockerfile, Kubernetes manifests, and a GitHub Actions workflow.'
    );
  }
  if (phase === 'agent-created' && !merged) {
    return t(
      'The agent has created a deployment PR. Review the generated files and merge to start the deployment pipeline.'
    );
  }
  return t('The deployment PR has been merged. The deployment pipeline is starting...');
};

const getTracking = (
  pipelineState: PipelineState,
  phase: PRPhase
): { url: string | null; number: number | null } => {
  if (phase === 'setup')
    return { url: pipelineState.setupPr.url, number: pipelineState.setupPr.number };
  if (phase === 'agent-created')
    return { url: pipelineState.generatedPr.url, number: pipelineState.generatedPr.number };
  return { url: pipelineState.triggerIssue.url, number: pipelineState.triggerIssue.number };
};

function useElapsedTime(startedAt: string | null): string | null {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!startedAt) {
      setElapsed(null);
      return;
    }
    const parsed = new Date(startedAt).getTime();
    if (isNaN(parsed)) {
      setElapsed('');
      return;
    }
    const update = () => {
      const seconds = Math.floor((Date.now() - parsed) / 1000);
      if (seconds < 60) {
        setElapsed(t('less than a minute'));
      } else {
        const minutes = Math.floor(seconds / 60);
        setElapsed(t('{{minutes}} min', { minutes }));
      }
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [startedAt, t]);

  return elapsed;
}

function getPhaseLabel(t: (key: string) => string, phaseId: string, fallbackLabel: string): string {
  switch (phaseId) {
    case 'setup':
      return t('Setting up environment');
    case 'working':
      return t('Analyzing repo, generating Dockerfile, K8s manifests, and workflow');
    default:
      return fallbackLabel;
  }
}

function AgentProgressPhases({
  phases,
  agentStartedAt,
}: {
  phases: AgentPhase[];
  agentStartedAt: string | null;
}) {
  const { t } = useTranslation();
  const elapsed = useElapsedTime(agentStartedAt);

  if (phases.length === 0) return null;
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
        {t('Agent Progress')}
      </Typography>
      {phases.map(phase => (
        <Box key={phase.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <StepStatusIcon status={phase.status as StepStatus} size={18} />
          <Typography
            variant="body2"
            sx={{
              color: phase.status === 'pending' ? 'text.disabled' : 'text.primary',
              fontWeight: phase.status === 'active' ? 600 : 400,
            }}
          >
            {getPhaseLabel(t, phase.id, phase.label)}
            {phase.id === 'working' && phase.status === 'active' && elapsed && (
              <Typography component="span" variant="body2" sx={{ color: 'text.secondary', ml: 1 }}>
                ({elapsed})
              </Typography>
            )}
          </Typography>
        </Box>
      ))}
      {agentStartedAt && (
        <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
          {t('This typically takes 10–25 minutes.')}
        </Typography>
      )}
    </Box>
  );
}

export function PRStatusScreen({
  pipelineState,
  prPhase,
  prStatus,
  isTimedOut,
  statusChecks,
  onReviewInGitHub,
  agentProgress,
}: PRStatusScreenProps) {
  const merged = prStatus?.merged ?? false;
  const isClosed = prStatus?.state === 'closed' && !merged;
  const { t } = useTranslation();
  const title = getTitle(t, prPhase, merged);
  const description = getDescription(t, prPhase, merged);
  const { url: prUrl, number: prNumber } = getTracking(pipelineState, prPhase);
  const isWaiting = prPhase === 'agent-pending';

  const hasAgentPhases = isWaiting && agentProgress && agentProgress.phases.length > 0;
  const spinnerState: 'agent-progress' | 'agent-spinner' | 'merge-check' | 'none' = hasAgentPhases
    ? 'agent-progress'
    : isWaiting && !merged && !isTimedOut
    ? 'agent-spinner'
    : !isWaiting && !merged && !isClosed && !isTimedOut
    ? 'merge-check'
    : 'none';

  return (
    <Box>
      {/* Header — left-aligned icon + title */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box
          component={Icon}
          icon={getHeaderIcon(prPhase, merged)}
          sx={{ fontSize: 28, color: getHeaderColor(prPhase, merged) }}
        />
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
      </Box>

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        {description}
      </Typography>

      {prNumber !== null && (
        <Typography variant="body2" sx={{ mb: 2, fontFamily: 'monospace' }}>
          {prPhase === 'agent-pending'
            ? t('Issue #{{number}}', { number: prNumber })
            : t('PR #{{number}}', { number: prNumber })}
        </Typography>
      )}

      {isTimedOut && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {prPhase === 'agent-pending'
            ? t(
                'This is taking longer than expected. The operation may still be in progress — check the GitHub issue for the latest status.'
              )
            : t(
                'This is taking longer than expected. The operation may still be in progress — check the PR on GitHub for the latest status.'
              )}
        </Alert>
      )}

      {isClosed && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {prPhase === 'agent-pending'
            ? t('This issue was closed. You may need to restart the process.')
            : t('This PR was closed without merging. You may need to restart the process.')}
        </Alert>
      )}

      {spinnerState === 'agent-progress' && agentProgress && (
        <AgentProgressPhases
          phases={agentProgress.phases}
          agentStartedAt={agentProgress.agentStartedAt}
        />
      )}

      {spinnerState === 'agent-spinner' && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <CircularProgress size={20} sx={{ mr: 1.5 }} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('Waiting for agent workflow to start...')}
          </Typography>
        </Box>
      )}

      {spinnerState === 'merge-check' && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <CircularProgress size={20} sx={{ mr: 1.5 }} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('Checking merge status...')}
          </Typography>
        </Box>
      )}

      {statusChecks && statusChecks.length > 0 && !merged && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
            {t('Status Checks')}
          </Typography>
          {statusChecks.map(check => (
            <Box key={check.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Box
                component={Icon}
                icon={getCheckIcon(check.conclusion, check.status)}
                sx={{
                  fontSize: 18,
                  color: getCheckColor(check.conclusion, check.status),
                }}
              />
              <Typography variant="body2">{check.name}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {!merged && !isClosed && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('You can close this panel — progress is saved and will resume when you return.')}
        </Alert>
      )}

      {prUrl && (
        <Button
          variant="outlined"
          onClick={onReviewInGitHub}
          startIcon={<Icon icon="mdi:open-in-new" aria-hidden="true" />}
          sx={{ textTransform: 'none' }}
        >
          {prPhase === 'agent-pending'
            ? t('View Issue on GitHub')
            : merged
            ? t('View on GitHub')
            : t('Review on GitHub')}
        </Button>
      )}
    </Box>
  );
}
