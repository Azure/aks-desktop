// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, Chip, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import type { AgentPhase } from '../hooks/useAgentWorkflowProgress';
import type { UsePRPollingResult } from '../hooks/usePRPolling';
import type { PipelineDeploymentState, PipelineState } from '../types';
import { getCheckColor, getCheckIcon } from '../utils/statusDisplay';
import { StepStatusIcon } from './StepStatusIcon';

type PrPolling = Pick<UsePRPollingResult, 'prStatus' | 'isTimedOut' | 'statusChecks'>;

interface ReviewAndMergeStepProps {
  deploymentState: PipelineDeploymentState;
  pipelineState: PipelineState;
  setupPrPolling: PrPolling;
  generatedPrPolling: PrPolling;
  agentWorkflowProgress: { phases: AgentPhase[]; agentStartedAt: string | null } | undefined;
  onReviewSetupPR: () => void;
  onReviewAgentIssue: () => void;
  onReviewDeploymentPR: () => void;
  repoFullName: string;
  onViewDeployment?: () => void;
}

type SubPhase = 'setup-pr' | 'copilot-agent' | 'deployment-pr';

function getSubPhaseStatus(
  subPhase: SubPhase,
  deploymentState: PipelineDeploymentState,
  setupMerged: boolean,
  generatedMerged: boolean
): 'done' | 'active' | 'upcoming' {
  switch (subPhase) {
    case 'setup-pr': {
      if (setupMerged) return 'done';
      if (deploymentState === 'SetupPRCreating' || deploymentState === 'SetupPRAwaitingMerge')
        return 'active';
      return 'upcoming';
    }
    case 'copilot-agent': {
      if (
        deploymentState === 'GeneratedPRAwaitingMerge' ||
        generatedMerged ||
        deploymentState === 'PipelineConfigured' ||
        deploymentState === 'PipelineRunning' ||
        deploymentState === 'Deployed'
      )
        return 'done';
      if (deploymentState === 'AgentTaskCreating' || deploymentState === 'AgentRunning')
        return 'active';
      return 'upcoming';
    }
    case 'deployment-pr': {
      if (
        generatedMerged ||
        deploymentState === 'PipelineConfigured' ||
        deploymentState === 'PipelineRunning' ||
        deploymentState === 'Deployed'
      )
        return 'done';
      if (deploymentState === 'GeneratedPRAwaitingMerge') return 'active';
      return 'upcoming';
    }
  }
}

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
      setElapsed(null);
      return;
    }
    const update = () => {
      const seconds = Math.floor((Date.now() - parsed) / 1000);
      if (seconds < 60) {
        setElapsed(t('less than a minute'));
      } else {
        const minutes = Math.floor(seconds / 60);
        setElapsed(t('{{count}} min', { count: minutes }));
      }
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [startedAt, t]);

  return elapsed;
}

function CompletedSummary({ items }: { items: { id: string; label: string }[] }) {
  return (
    <Box
      sx={{
        bgcolor: 'action.hover',
        borderRadius: 1,
        px: 2,
        py: 1.5,
        mb: 2,
      }}
    >
      {items.map(item => (
        <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <StepStatusIcon status="done" size={18} />
          <Typography variant="body2">{item.label}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function UpcomingSection({ title, description }: { title: string; description: string }) {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        borderTop: '1px solid',
        borderColor: 'divider',
        pt: 2,
        mt: 2,
      }}
    >
      <Chip label={t('Up next')} size="small" sx={{ mb: 1, fontSize: '0.7rem' }} />
      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.disabled' }}>
        {title}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.disabled' }}>
        {description}
      </Typography>
    </Box>
  );
}

function PRStatusCard({
  title,
  description,
  prNumber,
  prUrl,
  prPolling,
  onReviewInGitHub,
}: {
  title: string;
  description: string;
  prNumber: number | null;
  prUrl: string | null;
  prPolling: PrPolling;
  onReviewInGitHub: () => void;
}) {
  const { t } = useTranslation();
  const merged = prPolling.prStatus?.merged ?? false;
  const isClosed = prPolling.prStatus?.state === 'closed' && !merged;

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 2,
        mb: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box component={Icon} icon="mdi:source-pull" sx={{ fontSize: 24, color: 'primary.main' }} />
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {description}
      </Typography>

      {prNumber !== null && (
        <Box
          sx={{
            bgcolor: 'action.hover',
            borderRadius: 1,
            p: 1.5,
            mb: 2,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t('PR {{number}}', { number: prNumber })}
          </Typography>
          {prPolling.statusChecks &&
            prPolling.statusChecks.length > 0 &&
            !merged &&
            prPolling.statusChecks.map(check => (
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
          {!merged && !isClosed && !prPolling.statusChecks?.length && (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <CircularProgress size={16} sx={{ mr: 1 }} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('Checking merge status...')}
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {prPolling.isTimedOut && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('This is taking longer than expected. Check the PR on GitHub for the latest status.')}
        </Alert>
      )}

      {isClosed && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('This PR was closed without merging. You may need to restart the process.')}
        </Alert>
      )}

      {prUrl && (
        <Button
          variant="outlined"
          size="small"
          onClick={onReviewInGitHub}
          startIcon={<Icon icon="mdi:open-in-new" aria-hidden="true" />}
          sx={{ textTransform: 'none' }}
        >
          {t('Review on GitHub')}
        </Button>
      )}
    </Box>
  );
}

function ActiveAgentWorking({
  pipelineState,
  agentProgress,
  onReviewInGitHub,
}: {
  pipelineState: PipelineState;
  agentProgress: ReviewAndMergeStepProps['agentWorkflowProgress'];
  onReviewInGitHub: () => void;
}) {
  const { t } = useTranslation();
  const issueNumber = pipelineState.triggerIssue.number;
  const issueUrl = pipelineState.triggerIssue.url;
  const hasPhases = agentProgress && agentProgress.phases.length > 0;
  const elapsed = useElapsedTime(agentProgress?.agentStartedAt ?? null);

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 2,
        mb: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box component={Icon} icon="mdi:robot-outline" sx={{ fontSize: 24, color: 'info.main' }} />
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t('Agent is working')}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t(
          'The Copilot coding agent is analyzing your repo and generating a deployment PR with Dockerfile, Kubernetes manifests and a GitHub Actions workflow.'
        )}
      </Typography>

      {issueNumber !== null && (
        <Box
          sx={{
            bgcolor: 'action.hover',
            borderRadius: 1,
            p: 1.5,
            mb: 2,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t('Issue {{number}}', { number: issueNumber })}
          </Typography>
          {hasPhases ? (
            (agentProgress?.phases ?? []).map(phase => (
              <Box key={phase.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <StepStatusIcon status={phase.status} size={18} />
                <Typography
                  variant="body2"
                  sx={{
                    color: phase.status === 'pending' ? 'text.disabled' : 'text.primary',
                    fontWeight: phase.status === 'active' ? 600 : 400,
                  }}
                >
                  {phase.label}
                  {phase.id === 'working' && phase.status === 'active' && elapsed && (
                    <Typography
                      component="span"
                      variant="body2"
                      sx={{ color: 'text.secondary', ml: 1 }}
                    >
                      ({elapsed})
                    </Typography>
                  )}
                </Typography>
              </Box>
            ))
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <CircularProgress size={16} sx={{ mr: 1 }} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('Waiting for agent workflow to start...')}
              </Typography>
            </Box>
          )}
          {agentProgress?.agentStartedAt && (
            <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
              {t('This typically takes 10–25 minutes.')}
            </Typography>
          )}
        </Box>
      )}

      {issueUrl && (
        <Button
          variant="outlined"
          size="small"
          onClick={onReviewInGitHub}
          startIcon={<Icon icon="mdi:open-in-new" aria-hidden="true" />}
          sx={{ textTransform: 'none' }}
        >
          {t('Review on GitHub')}
        </Button>
      )}
    </Box>
  );
}

function PipelineComplete({
  repoFullName,
  onViewDeployment,
}: {
  repoFullName: string;
  onViewDeployment?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        border: '2px solid',
        borderColor: 'success.main',
        borderRadius: 1,
        p: 3,
      }}
    >
      <Box
        component={Icon}
        icon="mdi:check-circle"
        sx={{ fontSize: 40, color: 'success.main', mb: 1 }}
      />
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t('Pipeline configured')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t(
          'CI/CD pipeline for {{repoFullName}} is ready. Trigger deployments from the Deploy tab.',
          {
            repoFullName,
          }
        )}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="body2">
          <Box component="span" sx={{ mr: 1 }}>
            →
          </Box>
          {t('Setup PR reviewed and merged')}
        </Typography>
        <Typography variant="body2">
          <Box component="span" sx={{ mr: 1 }}>
            →
          </Box>
          {t('Copilot agent reviewed your repo and generated deployment PR')}
        </Typography>
        <Typography variant="body2">
          <Box component="span" sx={{ mr: 1 }}>
            →
          </Box>
          {t('Deployment PR reviewed and merged')}
        </Typography>
      </Box>
      {onViewDeployment && (
        <Button
          variant="contained"
          onClick={onViewDeployment}
          sx={{ textTransform: 'none', mt: 3 }}
        >
          {t('View deployment')}
        </Button>
      )}
    </Box>
  );
}

export function ReviewAndMergeStep({
  deploymentState,
  pipelineState,
  setupPrPolling,
  generatedPrPolling,
  agentWorkflowProgress,
  onReviewSetupPR,
  onReviewAgentIssue,
  onReviewDeploymentPR,
  repoFullName,
  onViewDeployment,
}: ReviewAndMergeStepProps) {
  const { t } = useTranslation();
  const setupMerged = setupPrPolling.prStatus?.merged || pipelineState.setupPr.merged || false;
  const generatedMerged =
    generatedPrPolling.prStatus?.merged || pipelineState.generatedPr.merged || false;

  const setupStatus = getSubPhaseStatus('setup-pr', deploymentState, setupMerged, generatedMerged);
  const agentStatus = getSubPhaseStatus(
    'copilot-agent',
    deploymentState,
    setupMerged,
    generatedMerged
  );
  const deployPRStatus = getSubPhaseStatus(
    'deployment-pr',
    deploymentState,
    setupMerged,
    generatedMerged
  );

  const isPipelineComplete =
    deploymentState === 'PipelineConfigured' ||
    deploymentState === 'Deployed' ||
    deploymentState === 'PipelineRunning';

  // Suppress the progress banner when a PR is closed without merging (flow can't proceed)
  const isPrClosedWithoutMerge =
    (setupStatus === 'active' &&
      setupPrPolling.prStatus?.state === 'closed' &&
      !setupPrPolling.prStatus?.merged) ||
    (deployPRStatus === 'active' &&
      generatedPrPolling.prStatus?.state === 'closed' &&
      !generatedPrPolling.prStatus?.merged);

  // Show the "collapse to save progress" info banner when work is in progress
  const showProgressBanner = !isPipelineComplete && !isPrClosedWithoutMerge;

  // Build completed items summary
  const completedItems: { id: string; label: string }[] = [];
  if (setupStatus === 'done')
    completedItems.push({ id: 'setup-pr', label: t('Setup PR reviewed and merged') });
  if (agentStatus === 'done')
    completedItems.push({
      id: 'copilot-agent',
      label: t('Copilot agent reviewed your repo and generated deployment PR'),
    });

  return (
    <Box>
      {showProgressBanner && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          icon={<Icon icon="mdi:information" aria-hidden="true" />}
        >
          {t('You can collapse this panel. Progress is saved and will resume when you return.')}
        </Alert>
      )}

      {/* Completed items summary */}
      {completedItems.length > 0 && !isPipelineComplete && (
        <CompletedSummary items={completedItems} />
      )}

      {/* Pipeline complete */}
      {isPipelineComplete && (
        <PipelineComplete repoFullName={repoFullName} onViewDeployment={onViewDeployment} />
      )}

      {/* Active section: Setup PR */}
      {setupStatus === 'active' &&
        (deploymentState === 'SetupPRCreating' ? (
          <Box display="flex" alignItems="center" sx={{ mt: 2, mb: 2 }}>
            <CircularProgress size={20} sx={{ mr: 2 }} />
            <Box>
              <Typography variant="subtitle1">{t('Creating setup PR...')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('The agent is creating the setup PR to enable the Copilot agent.')}
              </Typography>
            </Box>
          </Box>
        ) : (
          <PRStatusCard
            title={t('Setup PR Created')}
            description={t('Review and merge the setup PR to enable the Copilot agent.')}
            prNumber={pipelineState.setupPr.number}
            prUrl={pipelineState.setupPr.url}
            prPolling={setupPrPolling}
            onReviewInGitHub={onReviewSetupPR}
          />
        ))}

      {/* Active section: Agent working */}
      {agentStatus === 'active' &&
        (deploymentState === 'AgentTaskCreating' ? (
          <Box display="flex" alignItems="center" sx={{ mt: 2, mb: 2 }}>
            <CircularProgress size={20} sx={{ mr: 2 }} />
            <Box>
              <Typography variant="subtitle1">{t('Setting up Copilot agent...')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('Creating the trigger issue for the Copilot coding agent.')}
              </Typography>
            </Box>
          </Box>
        ) : (
          <ActiveAgentWorking
            pipelineState={pipelineState}
            agentProgress={agentWorkflowProgress}
            onReviewInGitHub={onReviewAgentIssue}
          />
        ))}

      {/* Active section: Deployment PR */}
      {deployPRStatus === 'active' && (
        <PRStatusCard
          title={t('Deployment PR Ready')}
          description={t(
            'The agent has created the deployment PR. Review the generated files and merge to start the deployment pipeline.'
          )}
          prNumber={pipelineState.generatedPr.number}
          prUrl={pipelineState.generatedPr.url}
          prPolling={generatedPrPolling}
          onReviewInGitHub={onReviewDeploymentPR}
        />
      )}

      {/* Upcoming sections */}
      {!isPipelineComplete && (
        <>
          {agentStatus === 'upcoming' && (
            <UpcomingSection
              title={t('Copilot agent')}
              description={t(
                'After merging, the Copilot agent will analyze your repo and create a deployment PR'
              )}
            />
          )}
          {deployPRStatus === 'upcoming' && (
            <UpcomingSection
              title={t('Deployment PR')}
              description={t(
                'Once agent has created deployment PR, review the generated files and merge to start the deployment pipeline'
              )}
            />
          )}
        </>
      )}
    </Box>
  );
}
