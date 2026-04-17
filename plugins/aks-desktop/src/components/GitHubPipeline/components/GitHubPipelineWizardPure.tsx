// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import { openExternalUrl } from '../../../utils/shared/openExternalUrl';
import type { useContainerConfiguration } from '../../DeployWizard/hooks/useContainerConfiguration';
import type { UseDockerfileDiscoveryReturn } from '../hooks/useDockerfileDiscovery';
import type { UseFastPathOrchestrationResult } from '../hooks/useFastPathOrchestration';
import type { UseGitHubPipelineOrchestrationResult } from '../hooks/useGitHubPipelineOrchestration';
import { getWizardStep } from '../utils/getWizardStep';
import { type AcrSelection, AcrSelector } from './AcrSelector';
import { AgentSetupReview } from './AgentSetupReview';
import { ConnectSourceStep } from './ConnectSourceStep';
import { DockerfileConfirmation } from './DockerfileConfirmation';
import { type DeployPathChoice, PathSelectionStep } from './PathSelectionStep';
import { ReviewAndMergeStep } from './ReviewAndMergeStep';
import { AGENT_PATH_STEPS, FAST_PATH_STEPS, WizardShell } from './WizardShell';
import { WorkloadIdentitySetup } from './WorkloadIdentitySetup';

const LoadingSpinner: React.FC<{ message: string }> = ({ message }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8 }}>
    <CircularProgress sx={{ mb: 2 }} />
    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
      {message}
    </Typography>
  </Box>
);

/**
 * Maps an error message to user-actionable recovery guidance.
 * Permission/timeout errors get tailored hints; everything else falls back to the generic retry message.
 */
function getRecoveryHint(t: (key: string) => string, error: string): string {
  const lower = error.toLowerCase();
  if (
    lower.includes('permission') ||
    lower.includes('forbidden') ||
    lower.includes('401') ||
    lower.includes('403')
  ) {
    return t('This may be a permissions issue. Check your GitHub App permissions and try again.');
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return t(
      'The operation may still be running on GitHub. Check the link above for the latest status.'
    );
  }
  return t('Try again, or check GitHub for details.');
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

/**
 * Pure presentational props for {@link GitHubPipelineWizardPure}.
 * Every value and callback is supplied by the {@link GitHubPipelineWizard} connector —
 * the component itself has no stateful business-logic hooks (only `useTranslation` for i18n).
 * This split lets stories and tests exercise every branch of the rendering logic without
 * mocking GitHub/Azure SDK calls.
 */
export interface GitHubPipelineWizardPureProps {
  /** AKS cluster name — used by `WorkloadIdentitySetup`. */
  clusterName: string;
  /** Kubernetes namespace the pipeline will deploy into. */
  namespace: string;
  /** Azure subscription id — used by `AcrSelector` and `WorkloadIdentitySetup`. */
  subscriptionId: string;
  /** Azure resource group containing the cluster — used by `AcrSelector` and `WorkloadIdentitySetup`. */
  resourceGroup: string;

  /** Invoked when the user closes the wizard (header close button or error "Go Back"). */
  onClose: () => void;
  /** Invoked when the user explicitly cancels/abandons the pipeline. */
  onCancel?: () => void;
  /** Invoked when the user clicks "View deployment" after the pipeline completes. */
  onViewDeployment?: () => void;

  /** Full return value of `useGitHubPipelineOrchestration`. */
  orchestration: UseGitHubPipelineOrchestrationResult;
  /** Full return value of `useFastPathOrchestration`. */
  fastPath: UseFastPathOrchestrationResult;
  /** Full return value of `useDockerfileDiscovery`. */
  dockerfileDiscovery: UseDockerfileDiscoveryReturn;
  /** Full return value of `useContainerConfiguration`, passed to `AgentSetupReview`. */
  localContainerConfig: ReturnType<typeof useContainerConfiguration>;

  /** Whether the target namespace is a managed AKS namespace. `undefined` while still resolving. */
  isManagedNamespace: boolean | undefined;
  /** Whether Azure RBAC for Kubernetes is enabled on the cluster. */
  azureRbacEnabled: boolean | undefined;

  /** Currently selected deployment path (fast / fast+AI / agent), or `null` before selection. */
  pathChoice: DeployPathChoice | null;
  /** Updates the selected path choice. Pass `null` to return to the selection screen. */
  onPathChoiceChange: (choice: DeployPathChoice | null) => void;

  /** Kicks off the fast-path deploy using the currently selected Dockerfile. */
  onFastPathDeploy: () => void;
}

/**
 * Pure presentational component for the GitHub pipeline wizard.
 *
 * Renders the appropriate step content and footer actions for the current
 * `pipeline.state.deploymentState` (or the fast-path state when the user has
 * chosen the fast/fast-with-ai path). Has no side effects beyond `useTranslation`.
 */
export function GitHubPipelineWizardPure({
  clusterName,
  namespace,
  subscriptionId,
  resourceGroup,
  onClose,
  onCancel,
  onViewDeployment,
  orchestration,
  fastPath,
  dockerfileDiscovery,
  localContainerConfig,
  isManagedNamespace,
  azureRbacEnabled,
  pathChoice,
  onPathChoiceChange,
  onFastPathDeploy,
}: GitHubPipelineWizardPureProps) {
  const { t } = useTranslation();

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
    setupPrPolling,
    generatedPrPolling,
    agentWorkflowProgress,
    identitySetup,
    projectName: resolvedProjectName,
  } = orchestration;

  const isFastPath = pathChoice === 'fast' || pathChoice === 'fast-with-ai';
  const dockerfilePaths = pipeline.state.repoReadiness?.dockerfilePaths ?? [];
  const hasDockerfile = dockerfilePaths.length > 0;

  const deploymentState = pipeline.state.deploymentState;
  const fastPathDeploymentState = fastPath.pipeline.state.deploymentState;
  const isFastPathActive = isFastPath && fastPathDeploymentState !== 'Configured';

  const activeStep = (() => {
    if (!isFastPathActive) {
      if (deploymentState === 'Failed') {
        return pipeline.state.lastSuccessfulState
          ? getWizardStep(pipeline.state.lastSuccessfulState)
          : 0;
      }
      return getWizardStep(deploymentState);
    }
    if (fastPathDeploymentState === 'Failed') return 1;
    return 2;
  })();

  const wizardSteps = isFastPath ? FAST_PATH_STEPS : AGENT_PATH_STEPS;
  const isAppInstallNeeded = deploymentState === 'AppInstallationNeeded';
  const repoFullName = pipeline.state.config
    ? `${pipeline.state.config.repo.owner}/${pipeline.state.config.repo.repo}`
    : '';

  function renderFastPathContent() {
    switch (fastPathDeploymentState) {
      case 'FastPathGenerating':
        return <LoadingSpinner message={t('Generating deployment files...')} />;
      case 'FastPathPRCreating':
        return <LoadingSpinner message={t('Creating pull request...')} />;
      case 'FastPathPRAwaitingMerge':
        return (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('Pull request created. Merge it to start the deployment.')}
            </Alert>
            {fastPath.pipeline.state.fastPathPr.url && (
              <Button
                variant="outlined"
                startIcon={<Icon icon="mdi:source-pull" aria-hidden="true" />}
                onClick={() => openExternalUrl(fastPath.pipeline.state.fastPathPr.url!)}
                sx={{ textTransform: 'none' }}
              >
                {t('Review PR on GitHub')}
              </Button>
            )}
          </>
        );
      case 'PipelineRunning':
        return (
          <>
            <LoadingSpinner message={t('Deployment in progress...')} />
            {fastPath.workflowPolling.runUrl && (
              <Box sx={{ textAlign: 'center' }}>
                <Button
                  variant="text"
                  onClick={() => openExternalUrl(fastPath.workflowPolling.runUrl!)}
                  sx={{ textTransform: 'none' }}
                >
                  {t('View workflow run')}
                </Button>
              </Box>
            )}
          </>
        );
      case 'Deployed':
      case 'AsyncAgentTriggered':
        return (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Icon icon="mdi:check-circle-outline" width={48} color="green" />
            <Typography variant="h6" sx={{ mt: 1, fontWeight: 600 }}>
              {t('Deployed to AKS')}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {localAppName} {t('is running in namespace')} {namespace}
            </Typography>
            {fastPath.pipeline.state.asyncAgentIssueUrl && (
              <Alert severity="info" sx={{ mt: 2, textAlign: 'left' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t('AI improvement suggestions in progress')}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t(
                    "Copilot is analyzing your Dockerfile and manifests. You'll receive a PR with optimization suggestions shortly."
                  )}
                </Typography>
                <Button
                  variant="text"
                  size="small"
                  onClick={() => openExternalUrl(fastPath.pipeline.state.asyncAgentIssueUrl!)}
                  sx={{ textTransform: 'none', mt: 0.5 }}
                >
                  {t('View issue on GitHub')}
                </Button>
              </Alert>
            )}
          </Box>
        );
      case 'Failed':
        return (
          <>
            <Alert severity="error" sx={{ mb: 2 }}>
              {fastPath.pipeline.state.error ?? t('Unknown error')}
            </Alert>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {getRecoveryHint(t, fastPath.pipeline.state.error ?? '')}
            </Typography>
          </>
        );
      default:
        return null;
    }
  }

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
          return <LoadingSpinner message={t('Initializing...')} />;
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
        return <LoadingSpinner message={t('Checking repository readiness...')} />;

      case 'AcrSelection':
        return (
          <AcrSelector
            subscriptionId={subscriptionId}
            resourceGroup={resourceGroup}
            onSelect={(selection: AcrSelection | null) => {
              pipeline.updateConfig({
                acrResourceId: selection?.acrResourceId,
                acrLoginServer: selection?.acrLoginServer,
              });
            }}
            value={
              pipeline.state.config?.acrResourceId && pipeline.state.config?.acrLoginServer
                ? {
                    acrResourceId: pipeline.state.config.acrResourceId,
                    acrLoginServer: pipeline.state.config.acrLoginServer,
                  }
                : null
            }
          />
        );

      case 'WorkloadIdentitySetup': {
        if (!selectedRepo || isManagedNamespace === undefined)
          return (
            <LoadingSpinner
              message={t(
                isManagedNamespace === undefined
                  ? 'Resolving namespace capabilities...'
                  : 'Loading...'
              )}
            />
          );
        return (
          <WorkloadIdentitySetup
            subscriptionId={subscriptionId}
            resourceGroup={resourceGroup}
            clusterName={clusterName}
            repo={selectedRepo}
            identitySetup={identitySetup}
            projectName={resolvedProjectName ?? namespace}
            acrResourceId={pipeline.state.config?.acrResourceId}
            isManagedNamespace={isManagedNamespace}
            namespaceName={namespace}
            azureRbacEnabled={azureRbacEnabled}
          />
        );
      }

      case 'ReadyForSetup': {
        if (!pipeline.state.config)
          return <LoadingSpinner message={t('Loading configuration...')} />;

        if (hasDockerfile && !pathChoice) {
          return (
            <PathSelectionStep
              dockerfilePath={dockerfilePaths[0]}
              selected={pathChoice}
              onSelect={onPathChoiceChange}
            />
          );
        }

        if (isFastPath) {
          if (isFastPathActive) {
            return renderFastPathContent();
          }
          return (
            <DockerfileConfirmation
              dockerfilePaths={dockerfilePaths}
              discovery={dockerfileDiscovery}
            />
          );
        }

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

      // All review & merge states are handled by the consolidated ReviewAndMergeStep
      case 'SetupPRCreating':
      case 'SetupPRAwaitingMerge':
      case 'AgentTaskCreating':
      case 'AgentRunning':
      case 'GeneratedPRAwaitingMerge':
      case 'PipelineConfigured':
      case 'PipelineRunning':
      case 'Deployed':
        return (
          <ReviewAndMergeStep
            deploymentState={deploymentState}
            pipelineState={pipeline.state}
            setupPrPolling={setupPrPolling}
            generatedPrPolling={generatedPrPolling}
            agentWorkflowProgress={agentWorkflowProgress}
            onReviewSetupPR={() => {
              if (pipeline.state.setupPr.url) openExternalUrl(pipeline.state.setupPr.url);
            }}
            onReviewAgentIssue={() => {
              if (pipeline.state.triggerIssue.url) openExternalUrl(pipeline.state.triggerIssue.url);
            }}
            onReviewDeploymentPR={() => {
              if (pipeline.state.generatedPr.url) openExternalUrl(pipeline.state.generatedPr.url);
            }}
            repoFullName={repoFullName}
            onViewDeployment={onViewDeployment}
          />
        );

      case 'Failed':
        return (
          <Box>
            <Alert severity="error" sx={{ mb: 2 }}>
              {pipeline.state.error ?? t('Unknown error')}
            </Alert>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {getRecoveryHint(t, pipeline.state.error ?? '')}
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
                {t('View on GitHub')}
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
            {t('Next')}
          </Button>
        );
      }
      case 'AcrSelection':
        return (
          <Button
            variant="contained"
            onClick={() => pipeline.setAcrCompleted()}
            sx={{ textTransform: 'none' }}
          >
            {t('Next')}
          </Button>
        );
      case 'ReadyForSetup': {
        if (hasDockerfile && !pathChoice) {
          return null;
        }

        if (isFastPath) {
          if (isFastPathActive) {
            if (fastPathDeploymentState === 'Failed') {
              return (
                <>
                  <Button
                    variant="outlined"
                    onClick={() => onPathChoiceChange(null)}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('Back')}
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => fastPath.pipeline.retry()}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('Retry')}
                  </Button>
                </>
              );
            }
            if (
              fastPathDeploymentState === 'Deployed' ||
              fastPathDeploymentState === 'AsyncAgentTriggered'
            ) {
              return (
                <Button
                  variant="contained"
                  onClick={onViewDeployment ?? onClose}
                  sx={{ textTransform: 'none' }}
                >
                  {onViewDeployment ? t('View Deployment') : t('Done')}
                </Button>
              );
            }
            return null;
          }
          return (
            <>
              <Button
                variant="outlined"
                onClick={() => onPathChoiceChange(null)}
                sx={{ textTransform: 'none' }}
              >
                {t('Back')}
              </Button>
              <Button
                variant="contained"
                disabled={!dockerfileDiscovery.selection}
                onClick={onFastPathDeploy}
                startIcon={<Icon icon="mdi:rocket-launch-outline" aria-hidden="true" />}
                sx={{ textTransform: 'none' }}
              >
                {t('Deploy')}
              </Button>
            </>
          );
        }

        const needsApp = !pipeline.state.config?.appName.trim() && !localAppName.trim();
        const readiness = pipeline.state.repoReadiness;
        const filesExist = !!(readiness?.hasSetupWorkflow && readiness?.hasAgentConfig);
        return (
          <>
            {hasDockerfile && (
              <Button
                variant="outlined"
                onClick={() => onPathChoiceChange(null)}
                sx={{ textTransform: 'none' }}
              >
                {t('Back')}
              </Button>
            )}
            <Button
              variant="contained"
              disabled={needsApp}
              onClick={handleCreateSetupPR}
              startIcon={
                <Icon
                  icon={filesExist ? 'mdi:robot-outline' : 'mdi:source-pull'}
                  aria-hidden="true"
                />
              }
              sx={{ textTransform: 'none' }}
            >
              {filesExist ? t('Trigger Copilot Agent') : t('Create Setup PR')}
            </Button>
          </>
        );
      }
      case 'Failed':
        return (
          <>
            <Button variant="outlined" onClick={onClose} sx={{ textTransform: 'none' }}>
              {t('Back')}
            </Button>
            <Button
              variant="contained"
              onClick={() => pipeline.retry()}
              sx={{ textTransform: 'none' }}
            >
              {t('Retry')}
            </Button>
          </>
        );
      default:
        // No footer actions for review & merge states — the CTA is inline
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
        steps={wizardSteps}
      >
        {renderContent()}
      </WizardShell>
    </PipelineErrorBoundary>
  );
}
