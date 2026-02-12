// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import type { PipelineState } from '../types';

/**
 * Which PR phase we're currently tracking.
 */
type PRPhase = 'setup' | 'agent-pending' | 'agent-created';

interface PRStatusScreenProps {
  /** Current pipeline state including PR details. */
  pipelineState: PipelineState;
  /** Current phase of the two-PR flow. */
  prPhase: PRPhase;
  /** Latest PR status from polling. */
  prStatus: {
    state: string;
    merged: boolean;
    mergeable: boolean | null;
  } | null;
  /** Whether polling timed out. */
  isTimedOut: boolean;
  /** CI/CD status checks on the PR. */
  statusChecks: Array<{ name: string; status: string; conclusion: string | null }> | null;
  /** Opens PR URL in browser. */
  onReviewInGitHub: () => void;
  /** Returns to previous step. */
  onBack: () => void;
}

const PhaseIcon: React.FC<{ phase: PRPhase; merged: boolean }> = ({ phase, merged }) => {
  if (merged) {
    return (
      <Box
        component={Icon}
        icon="mdi:check-circle"
        sx={{ fontSize: 48, color: 'success.main', display: 'block', mx: 'auto', mb: 2 }}
      />
    );
  }
  if (phase === 'agent-pending') {
    return (
      <Box
        component={Icon}
        icon="mdi:robot-outline"
        sx={{ fontSize: 48, color: 'info.main', display: 'block', mx: 'auto', mb: 2 }}
      />
    );
  }
  return (
    <Box
      component={Icon}
      icon="mdi:source-pull"
      sx={{ fontSize: 48, color: 'primary.main', display: 'block', mx: 'auto', mb: 2 }}
    />
  );
};

const getTitle = (phase: PRPhase, merged: boolean): string => {
  if (phase === 'setup') {
    return merged ? 'Setup PR Merged' : 'Setup PR Created';
  }
  if (phase === 'agent-pending') {
    return 'Agent is Working';
  }
  return merged ? 'Deployment PR Merged' : 'Deployment PR Ready';
};

const getDescription = (phase: PRPhase, merged: boolean): string => {
  if (phase === 'setup' && !merged) {
    return 'Review and merge the setup PR to enable the Copilot agent. After merging, the agent will analyze your repo and create a deployment PR.';
  }
  if (phase === 'setup' && merged) {
    return 'The setup PR has been merged. The Copilot agent is now being triggered...';
  }
  if (phase === 'agent-pending') {
    return 'The Copilot Coding Agent is analyzing your repository and generating a deployment PR with Dockerfile, Kubernetes manifests, and a GitHub Actions workflow.';
  }
  if (phase === 'agent-created' && !merged) {
    return 'The agent has created a deployment PR. Review the generated files and merge to start the deployment pipeline.';
  }
  return 'The deployment PR has been merged. The deployment pipeline is starting...';
};

const getTrackingUrl = (pipelineState: PipelineState, phase: PRPhase): string | null => {
  if (phase === 'setup') {
    return pipelineState.setupPr.url;
  }
  if (phase === 'agent-created') {
    return pipelineState.generatedPr.url;
  }
  return pipelineState.triggerIssue.url;
};

const getTrackingNumber = (pipelineState: PipelineState, phase: PRPhase): number | null => {
  if (phase === 'setup') {
    return pipelineState.setupPr.number;
  }
  if (phase === 'agent-created') {
    return pipelineState.generatedPr.number;
  }
  return pipelineState.triggerIssue.number;
};

const getCheckIcon = (conclusion: string | null, status: string): string => {
  if (conclusion === 'success') return 'mdi:check-circle';
  if (conclusion === 'failure') return 'mdi:close-circle';
  if (conclusion === 'cancelled' || conclusion === 'skipped') return 'mdi:minus-circle';
  if (status === 'in_progress' || status === 'queued') return 'mdi:progress-clock';
  return 'mdi:help-circle-outline';
};

const getCheckColor = (conclusion: string | null, status: string): string => {
  if (conclusion === 'success') return 'success.main';
  if (conclusion === 'failure') return 'error.main';
  if (status === 'in_progress' || status === 'queued') return 'info.main';
  return 'text.secondary';
};

export const PRStatusScreen: React.FC<PRStatusScreenProps> = ({
  pipelineState,
  prPhase,
  prStatus,
  isTimedOut,
  statusChecks,
  onReviewInGitHub,
  onBack,
}) => {
  const merged = prStatus?.merged ?? false;
  const isClosed = prStatus?.state === 'closed' && !merged;
  const title = getTitle(prPhase, merged);
  const description = getDescription(prPhase, merged);
  const prUrl = getTrackingUrl(pipelineState, prPhase);
  const prNumber = getTrackingNumber(pipelineState, prPhase);
  const isWaiting = prPhase === 'agent-pending';

  return (
    <Card sx={{ maxWidth: 560, width: '100%', textAlign: 'center', p: 4 }}>
      <CardContent>
        <PhaseIcon phase={prPhase} merged={merged} />

        <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>
          {title}
        </Typography>

        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          {description}
        </Typography>

        {prNumber && (
          <Typography variant="body2" sx={{ mb: 1, fontFamily: 'monospace' }}>
            {prPhase === 'agent-pending' ? `Issue #${prNumber}` : `PR #${prNumber}`}
          </Typography>
        )}

        {isTimedOut && (
          <Alert severity="warning" sx={{ mb: 2, textAlign: 'left' }}>
            This is taking longer than expected. The operation may still be in progress
            {' \u2014 '}
            check the {prPhase === 'agent-pending' ? 'GitHub issue' : 'PR on GitHub'} for the latest
            status.
          </Alert>
        )}

        {isClosed && (
          <Alert severity="warning" sx={{ mb: 2, textAlign: 'left' }}>
            This{' '}
            {prPhase === 'agent-pending' ? 'issue was closed' : 'PR was closed without merging'}.
            You may need to restart the process.
          </Alert>
        )}

        {isWaiting && !merged && !isTimedOut && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mb: 3 }}>
            <CircularProgress size={24} sx={{ mr: 1.5 }} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Waiting for agent to create deployment PR...
            </Typography>
          </Box>
        )}

        {!isWaiting && !merged && !isClosed && !isTimedOut && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mb: 3 }}>
            <CircularProgress size={20} sx={{ mr: 1 }} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Checking merge status...
            </Typography>
          </Box>
        )}

        {statusChecks && statusChecks.length > 0 && !merged && (
          <Box sx={{ mb: 3, textAlign: 'left' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
              Status Checks
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

        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
          {prUrl && (
            <Button
              variant="contained"
              color="primary"
              onClick={onReviewInGitHub}
              startIcon={<Icon icon="mdi:open-in-new" />}
              sx={{ textTransform: 'none', fontSize: 14 }}
            >
              {prPhase === 'agent-pending'
                ? 'View Issue on GitHub'
                : merged
                ? 'View on GitHub'
                : 'Review on GitHub'}
            </Button>
          )}
          <Button
            variant="outlined"
            color="secondary"
            onClick={onBack}
            sx={{ textTransform: 'none', fontSize: 14 }}
          >
            Back
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
};
