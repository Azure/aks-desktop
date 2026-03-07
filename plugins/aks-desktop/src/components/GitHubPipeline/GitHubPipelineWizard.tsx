// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import React, { useEffect, useRef } from 'react';
import type { GitHubRepo } from '../../types/github';
import { openExternalUrl } from '../../utils/shared/openExternalUrl';
import type { ContainerConfig } from '../DeployWizard/hooks/useContainerConfiguration';
import { useContainerConfiguration } from '../DeployWizard/hooks/useContainerConfiguration';
import { AgentSetupReview } from './components/AgentSetupReview';
import { ConnectSourceStep } from './components/ConnectSourceStep';
import { DeploymentStatusScreen } from './components/DeploymentStatusScreen';
import { PipelineConfiguredScreen } from './components/PipelineConfiguredScreen';
import { PRStatusScreen } from './components/PRStatusScreen';
import { WizardShell } from './components/WizardShell';
import { WorkloadIdentitySetup } from './components/WorkloadIdentitySetup';
import { useGitHubPipelineOrchestration } from './hooks/useGitHubPipelineOrchestration';
import { getWizardStep } from './utils/getWizardStep';

interface GitHubPipelineWizardProps {
  /** Cluster name — used for both K8s operations and PipelineConfig. */
  clusterName: string;
  namespace: string;
  /** Application name. Defaults to `''` (derived from repo name at runtime). */
  appName?: string;
  subscriptionId: string;
  resourceGroup: string;
  tenantId: string;
  onClose: () => void;
  /** Called when the user explicitly cancels/abandons the pipeline (clears progress). */
  onCancel?: () => void;
  /** Pre-selected repo for resuming an in-progress pipeline. */
  initialRepo?: GitHubRepo;
  /** Container configuration from the deploy wizard. */
  containerConfig?: ContainerConfig;
  /**
   * Pipeline mode:
   * - 'configure': Ends at PipelineConfigured after generated PR merges (no auto-deploy).
   * - 'deploy': Full flow through PipelineRunning → Deployed.
   * Defaults to 'deploy'.
   */
  mode?: 'configure' | 'deploy';
}

const LoadingSpinner: React.FC<{ message: string }> = ({ message }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8 }}>
    <CircularProgress sx={{ mb: 2 }} />
    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
      {message}
    </Typography>
  </Box>
);

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

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[GitHubPipelineWizard] Render error:', error, errorInfo.componentStack);
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

export function GitHubPipelineWizard({
  clusterName,
  namespace,
  appName = '',
  subscriptionId,
  resourceGroup,
  tenantId,
  onClose,
  onCancel,
  initialRepo,
  containerConfig,
  mode = 'deploy',
}: GitHubPipelineWizardProps) {
  const localContainerConfig = useContainerConfiguration(appName);

  useEffect(() => {
    if (containerConfig) {
      localContainerConfig.setConfig(containerConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    gitHubAuth,
    selectedRepo,
    setSelectedRepo,
    appInstallUrl,
    pipeline,
    identityId,
    localAppName,
    setLocalAppName,
    checkRepoAndApp,
    handleCreateSetupPR,
    handleRedeploy,
    setupPrPolling,
    generatedPrPolling,
    agentWorkflowProgress,
    workflowPolling,
    deploymentHealth,
    identitySetup,
  } = useGitHubPipelineOrchestration({
    clusterName,
    namespace,
    appName,
    subscriptionId,
    resourceGroup,
    tenantId,
    initialRepo,
    containerConfig: localContainerConfig.config,
    mode,
  });

  useEffect(() => {
    if (localContainerConfig.config.appName !== localAppName) {
      localContainerConfig.setConfig(c => ({ ...c, appName: localAppName }));
    }
  }, [localAppName, localContainerConfig.config.appName, localContainerConfig.setConfig]);

  const deploymentState = pipeline.state.deploymentState;

  const activeStep =
    deploymentState === 'Failed'
      ? pipeline.state.lastSuccessfulState
        ? getWizardStep(pipeline.state.lastSuccessfulState)
        : 0
      : getWizardStep(deploymentState);

  // Latch first successful auth to avoid cross-tree flicker regression.
  const authAdvancedRef = useRef(false);
  const setAuthCompletedRef = useRef(pipeline.setAuthCompleted);
  useEffect(() => {
    setAuthCompletedRef.current = pipeline.setAuthCompleted;
  }, [pipeline.setAuthCompleted]);

  useEffect(() => {
    if (
      !authAdvancedRef.current &&
      deploymentState === 'GitHubAuthorizationNeeded' &&
      gitHubAuth.authState.isAuthenticated
    ) {
      authAdvancedRef.current = true;
      setAuthCompletedRef.current();
    }
  }, [deploymentState, gitHubAuth.authState.isAuthenticated]);

  const isAppInstallNeeded = deploymentState === 'AppInstallationNeeded';

  function renderContent() {
    switch (deploymentState) {
      case 'GitHubAuthorizationNeeded':
      case 'AppInstallationNeeded':
      case 'Configured': {
        if (
          selectedRepo &&
          !isAppInstallNeeded &&
          gitHubAuth.authState.isAuthenticated &&
          gitHubAuth.octokit
        ) {
          return <LoadingSpinner message="Initializing..." />;
        }
        return (
          <ConnectSourceStep
            authState={gitHubAuth.authState}
            onStartOAuth={() => gitHubAuth.startOAuth()}
            octokit={gitHubAuth.octokit}
            selectedRepo={selectedRepo}
            onRepoSelect={setSelectedRepo}
            appInstallNeeded={isAppInstallNeeded}
            appInstallUrl={appInstallUrl}
            authCompleted={deploymentState !== 'GitHubAuthorizationNeeded'}
          />
        );
      }

      case 'CheckingRepo':
        return <LoadingSpinner message="Checking repository readiness..." />;

      case 'WorkloadIdentitySetup': {
        if (!selectedRepo) return <LoadingSpinner message="Loading..." />;
        return (
          <WorkloadIdentitySetup
            subscriptionId={subscriptionId}
            resourceGroup={resourceGroup}
            namespace={namespace}
            repo={selectedRepo}
            identitySetup={identitySetup}
          />
        );
      }

      case 'ReadyForSetup': {
        if (!pipeline.state.config) return <LoadingSpinner message="Loading configuration..." />;

        const readiness = pipeline.state.repoReadiness;
        const filesAlreadyExist = !!(readiness?.hasSetupWorkflow && readiness?.hasAgentConfig);
        return (
          <AgentSetupReview
            config={pipeline.state.config}
            identityId={identityId}
            appName={localAppName}
            onAppNameChange={setLocalAppName}
            filesExist={filesAlreadyExist}
            containerConfig={localContainerConfig}
          />
        );
      }

      case 'SetupPRCreating':
        return <LoadingSpinner message="Creating setup PR..." />;

      case 'SetupPRAwaitingMerge':
        return (
          <PRStatusScreen
            pipelineState={pipeline.state}
            prPhase="setup"
            prStatus={setupPrPolling.prStatus}
            isTimedOut={setupPrPolling.isTimedOut}
            statusChecks={setupPrPolling.statusChecks}
            onReviewInGitHub={() => {
              if (pipeline.state.setupPr.url) openExternalUrl(pipeline.state.setupPr.url);
            }}
          />
        );

      case 'AgentTaskCreating':
        return <LoadingSpinner message="Creating agent task..." />;

      case 'AgentRunning':
        return (
          <PRStatusScreen
            pipelineState={pipeline.state}
            prPhase="agent-pending"
            prStatus={null}
            isTimedOut={false}
            statusChecks={null}
            onReviewInGitHub={() => {
              if (pipeline.state.triggerIssue.url) openExternalUrl(pipeline.state.triggerIssue.url);
            }}
            agentProgress={agentWorkflowProgress}
          />
        );

      case 'GeneratedPRAwaitingMerge':
        return (
          <PRStatusScreen
            pipelineState={pipeline.state}
            prPhase="agent-created"
            prStatus={generatedPrPolling.prStatus}
            isTimedOut={generatedPrPolling.isTimedOut}
            statusChecks={generatedPrPolling.statusChecks}
            onReviewInGitHub={() => {
              if (pipeline.state.generatedPr.url) openExternalUrl(pipeline.state.generatedPr.url);
            }}
          />
        );

      case 'PipelineConfigured':
        return (
          <PipelineConfiguredScreen
            repoFullName={
              pipeline.state.config
                ? `${pipeline.state.config.repo.owner}/${pipeline.state.config.repo.repo}`
                : ''
            }
          />
        );

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
            deploymentHealthError={deploymentHealth.error}
            onRedeploy={handleRedeploy}
            onOpenGitHubRun={() => {
              if (workflowPolling.runUrl) openExternalUrl(workflowPolling.runUrl);
            }}
          />
        );

      case 'Failed':
        return (
          <Box>
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
                onClick={() => {
                  const url =
                    pipeline.state.generatedPr.url ??
                    pipeline.state.triggerIssue.url ??
                    pipeline.state.setupPr.url;
                  if (url) openExternalUrl(url);
                }}
              >
                View on GitHub
              </Button>
            )}
          </Box>
        );

      default:
        return null;
    }
  }

  function renderFooterActions() {
    switch (deploymentState) {
      case 'GitHubAuthorizationNeeded':
      case 'AppInstallationNeeded':
      case 'Configured': {
        const canProceed = !!selectedRepo && !isAppInstallNeeded;
        if (!gitHubAuth.authState.isAuthenticated) return null;
        return (
          <Button
            variant="contained"
            disabled={!canProceed}
            onClick={() => canProceed && checkRepoAndApp()}
            sx={{ textTransform: 'none' }}
          >
            Next
          </Button>
        );
      }
      case 'ReadyForSetup': {
        const needsApp = !pipeline.state.config?.appName.trim() && !localAppName.trim();
        const readiness = pipeline.state.repoReadiness;
        const filesExist = !!(readiness?.hasSetupWorkflow && readiness?.hasAgentConfig);
        return (
          <Button
            variant="contained"
            disabled={needsApp}
            onClick={handleCreateSetupPR}
            startIcon={<Icon icon={filesExist ? 'mdi:robot-outline' : 'mdi:source-pull'} />}
            sx={{ textTransform: 'none' }}
          >
            {filesExist ? 'Trigger Copilot Agent' : 'Create Setup PR'}
          </Button>
        );
      }
      case 'PipelineConfigured':
      case 'Deployed':
        return (
          <Button variant="contained" onClick={onClose} sx={{ textTransform: 'none' }}>
            Done
          </Button>
        );
      case 'Failed':
        return (
          <>
            <Button variant="outlined" onClick={onClose} sx={{ textTransform: 'none' }}>
              Back
            </Button>
            <Button
              variant="contained"
              onClick={() => pipeline.retry()}
              sx={{ textTransform: 'none' }}
            >
              Retry
            </Button>
          </>
        );
      default:
        return null;
    }
  }

  return (
    <PipelineErrorBoundary onClose={onClose}>
      <WizardShell
        activeStep={activeStep}
        onClose={onClose}
        onCancel={onCancel}
        footerActions={renderFooterActions()}
      >
        {renderContent()}
      </WizardShell>
    </PipelineErrorBoundary>
  );
}
