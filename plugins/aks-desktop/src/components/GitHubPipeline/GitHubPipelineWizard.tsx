// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import { AgentSetupReview } from './components/AgentSetupReview';
import { AppInstallScreen } from './components/AppInstallScreen';
import { DeploymentStatusScreen } from './components/DeploymentStatusScreen';
import { GitHubAuthScreen } from './components/GitHubAuthScreen';
import { PRStatusScreen } from './components/PRStatusScreen';
import { RepoSelector } from './components/RepoSelector';
import { useGitHubPipelineOrchestration } from './hooks/useGitHubPipelineOrchestration';

interface GitHubPipelineWizardProps {
  /** Cluster name — used for both K8s operations and PipelineConfig. */
  clusterName: string;
  namespace: string;
  appName: string;
  subscriptionId: string;
  resourceGroup: string;
  tenantId: string;
  onClose: () => void;
}

/**
 * Centered loading spinner used for transient states.
 */
const LoadingSpinner: React.FC<{ message: string }> = ({ message }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8 }}>
    <CircularProgress sx={{ mb: 2 }} />
    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
      {message}
    </Typography>
  </Box>
);

/**
 * Returns actionable recovery guidance based on the error message.
 */
function getRecoveryHint(error: string): string {
  const lower = error.toLowerCase();
  if (
    lower.includes('permission') ||
    lower.includes('forbidden') ||
    lower.includes('401') ||
    lower.includes('403')
  ) {
    return 'This may be a permissions issue. Check your GitHub App permissions and try again.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'The operation may still be running on GitHub. Check the link above for the latest status.';
  }
  return 'Try again, or check GitHub for details.';
}

/**
 * Error boundary that catches render errors in the wizard and shows a
 * recovery UI instead of a blank screen.
 */
class PipelineErrorBoundary extends React.Component<
  { onClose: () => void; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Box sx={{ p: 3 }}>
          <Alert severity="error" sx={{ mb: 2 }}>
            Something went wrong: {this.state.error.message}
          </Alert>
          <Button variant="outlined" onClick={this.props.onClose}>
            Go Back
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

export default function GitHubPipelineWizard({
  clusterName,
  namespace,
  appName,
  subscriptionId,
  resourceGroup,
  tenantId,
  onClose,
}: GitHubPipelineWizardProps) {
  const {
    gitHubAuth,
    selectedRepo,
    setSelectedRepo,
    appInstallUrl,
    pipeline,
    identityId,
    setIdentityId,
    localAppName,
    setLocalAppName,
    checkRepoAndApp,
    handleCreateSetupPR,
    handleRedeploy,
    setupPrPolling,
    generatedPrPolling,
    workflowPolling,
    deploymentHealth,
  } = useGitHubPipelineOrchestration({
    clusterName,
    namespace,
    appName,
    subscriptionId,
    resourceGroup,
    tenantId,
  });

  // --- Render the appropriate screen based on state ---
  const content = (() => {
    switch (pipeline.state.deploymentState) {
      // Screen B — GitHub Authorization Required
      case 'GitHubAuthorizationNeeded':
        return (
          <GitHubAuthScreen
            authState={gitHubAuth.authState}
            onStartDeviceFlow={() => gitHubAuth.startDeviceFlow()}
            onCancel={onClose}
            onContinue={() => {
              pipeline.setAuthCompleted();
            }}
          />
        );

      // Screen B2 — GitHub App Installation Required
      case 'AppInstallationNeeded':
        if (!selectedRepo) return <LoadingSpinner message="Loading..." />;
        return (
          <AppInstallScreen
            owner={selectedRepo.owner}
            repo={selectedRepo.repo}
            installUrl={appInstallUrl}
            onCheckAgain={checkRepoAndApp}
            onCancel={onClose}
          />
        );

      // Screen A — Repo Selection
      case 'Configured':
        if (!selectedRepo) {
          if (!gitHubAuth.octokit) return <LoadingSpinner message="Connecting..." />;
          return <RepoSelector octokit={gitHubAuth.octokit} onRepoSelect={setSelectedRepo} />;
        }
        // Will auto-proceed to CheckingRepo via useEffect
        return <LoadingSpinner message="Initializing..." />;

      case 'CheckingRepo':
        return <LoadingSpinner message="Checking repository readiness..." />;

      // ReadyForSetup — show AgentSetupReview before creating setup PR (or triggering agent)
      case 'ReadyForSetup': {
        if (!pipeline.state.config) return <LoadingSpinner message="Loading configuration..." />;
        const readiness = pipeline.state.repoReadiness;
        const filesAlreadyExist = !!(readiness?.hasSetupWorkflow && readiness?.hasAgentConfig);
        return (
          <AgentSetupReview
            config={pipeline.state.config}
            onSetupAgent={handleCreateSetupPR}
            identityId={identityId}
            onIdentityIdChange={setIdentityId}
            appName={localAppName}
            onAppNameChange={setLocalAppName}
            filesExist={filesAlreadyExist}
          />
        );
      }

      case 'SetupPRCreating':
        return <LoadingSpinner message="Creating setup PR..." />;

      // Screen C — Setup PR awaiting merge
      case 'SetupPRAwaitingMerge':
        return (
          <PRStatusScreen
            pipelineState={pipeline.state}
            prPhase="setup"
            prStatus={setupPrPolling.prStatus}
            isTimedOut={setupPrPolling.isTimedOut}
            statusChecks={setupPrPolling.statusChecks}
            onReviewInGitHub={() => window.open(pipeline.state.setupPr.url ?? '', '_blank')}
            onBack={onClose}
          />
        );

      // Copilot Not Enabled — fallback screen (shouldn't be reached in normal flow)
      case 'CopilotNotEnabled':
        return (
          <Box sx={{ p: 3 }}>
            <Alert severity="warning" sx={{ mb: 3 }}>
              Copilot Coding Agent may not be available for {selectedRepo?.owner}/
              {selectedRepo?.repo}
            </Alert>
            <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
              Ensure Copilot Coding Agent is enabled for this repository in your GitHub or
              organization settings.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
              <Button variant="contained" onClick={checkRepoAndApp}>
                Retry
              </Button>
              <Button variant="outlined" onClick={onClose}>
                Cancel
              </Button>
            </Box>
          </Box>
        );

      case 'AgentTaskCreating':
        return <LoadingSpinner message="Creating agent task..." />;

      // Screen D — Agent Running
      case 'AgentRunning':
        return (
          <PRStatusScreen
            pipelineState={pipeline.state}
            prPhase="agent-pending"
            prStatus={null}
            isTimedOut={false}
            statusChecks={null}
            onReviewInGitHub={() => window.open(pipeline.state.triggerIssue.url ?? '', '_blank')}
            onBack={onClose}
          />
        );

      // Screen E — Generated PR awaiting merge
      case 'GeneratedPRAwaitingMerge':
        return (
          <PRStatusScreen
            pipelineState={pipeline.state}
            prPhase="agent-created"
            prStatus={generatedPrPolling.prStatus}
            isTimedOut={generatedPrPolling.isTimedOut}
            statusChecks={generatedPrPolling.statusChecks}
            onReviewInGitHub={() => window.open(pipeline.state.generatedPr.url ?? '', '_blank')}
            onBack={onClose}
          />
        );

      // Screen F — Deployment Status
      case 'PipelineRunning':
      case 'Deployed':
        return (
          <DeploymentStatusScreen
            pipelineState={pipeline.state}
            workflowStatus={{
              status: workflowPolling.runStatus,
              conclusion: workflowPolling.runConclusion,
              url: workflowPolling.runUrl,
            }}
            deploymentHealth={{
              ready: deploymentHealth.deploymentReady,
              podStatuses: deploymentHealth.podStatuses,
              serviceEndpoint: deploymentHealth.serviceEndpoint,
            }}
            onRedeploy={handleRedeploy}
            onOpenGitHubRun={() => window.open(workflowPolling.runUrl ?? '', '_blank')}
          />
        );

      // Failed — inline error with retry
      case 'Failed':
        return (
          <Box sx={{ p: 3 }}>
            <Alert severity="error" sx={{ mb: 2 }}>
              {pipeline.state.error ?? 'Unknown error'}
            </Alert>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {getRecoveryHint(pipeline.state.error ?? '')}
            </Typography>
            {(pipeline.state.setupPr.url ||
              pipeline.state.triggerIssue.url ||
              pipeline.state.generatedPr.url) && (
              <Button
                variant="text"
                onClick={() =>
                  window.open(
                    pipeline.state.generatedPr.url ??
                      pipeline.state.triggerIssue.url ??
                      pipeline.state.setupPr.url ??
                      '',
                    '_blank'
                  )
                }
              >
                View on GitHub
              </Button>
            )}
            <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
              <Button variant="contained" onClick={() => pipeline.retry()}>
                Retry
              </Button>
              <Button variant="outlined" onClick={onClose}>
                Back
              </Button>
            </Box>
          </Box>
        );

      default:
        return null;
    }
  })();

  return <PipelineErrorBoundary onClose={onClose}>{content}</PipelineErrorBoundary>;
}
