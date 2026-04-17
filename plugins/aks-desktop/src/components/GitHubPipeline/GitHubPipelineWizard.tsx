// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNamespaceCapabilities } from '../../hooks/useNamespaceCapabilities';
import type { GitHubRepo } from '../../types/github';
import type { ContainerConfig } from '../DeployWizard/hooks/useContainerConfiguration';
import { useContainerConfiguration } from '../DeployWizard/hooks/useContainerConfiguration';
import { GitHubPipelineWizardPure } from './components/GitHubPipelineWizardPure';
import type { DeployPathChoice } from './components/PathSelectionStep';
import { useDockerfileDiscovery } from './hooks/useDockerfileDiscovery';
import { useFastPathOrchestration } from './hooks/useFastPathOrchestration';
import { useGitHubPipelineOrchestration } from './hooks/useGitHubPipelineOrchestration';

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
  /** Called when the user clicks "View deployment" after pipeline is configured. */
  onViewDeployment?: () => void;
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
  /** Project name — used for identity naming and resource group defaults. */
  projectName?: string;
}

/**
 * Thin connector for the GitHub pipeline wizard.
 *
 * Composes the pipeline/fast-path/dockerfile/container hooks with
 * {@link GitHubPipelineWizardPure}. The connector's only responsibilities are:
 * - Calling the hooks that produce orchestration state.
 * - Managing the local `pathChoice` state and latched auth-completion effect.
 * - Passing everything as props to the pure component for rendering.
 *
 * Stories test {@link GitHubPipelineWizardPure} directly with mocked hook results,
 * which avoids needing to stub Azure/GitHub SDK calls.
 */
export function GitHubPipelineWizard({
  clusterName,
  namespace,
  appName = '',
  subscriptionId,
  resourceGroup,
  tenantId,
  onClose,
  onCancel,
  onViewDeployment,
  initialRepo,
  containerConfig,
  mode = 'deploy',
  projectName,
}: GitHubPipelineWizardProps) {
  const localContainerConfig = useContainerConfiguration(appName);
  const { isManagedNamespace, azureRbacEnabled } = useNamespaceCapabilities({
    subscriptionId,
    resourceGroup,
    clusterName,
    namespace,
  });

  useEffect(() => {
    if (containerConfig) {
      localContainerConfig.setConfig(containerConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orchestration = useGitHubPipelineOrchestration({
    clusterName,
    namespace,
    appName,
    subscriptionId,
    resourceGroup,
    tenantId,
    initialRepo,
    containerConfig: localContainerConfig.config,
    mode,
    projectName,
  });

  useEffect(() => {
    if (localContainerConfig.config.appName !== orchestration.localAppName) {
      localContainerConfig.setConfig(c => ({ ...c, appName: orchestration.localAppName }));
    }
  }, [
    orchestration.localAppName,
    localContainerConfig.config.appName,
    localContainerConfig.setConfig,
  ]);

  const [pathChoice, setPathChoice] = useState<DeployPathChoice | null>(null);
  const dockerfilePaths = orchestration.pipeline.state.repoReadiness?.dockerfilePaths ?? [];
  const dockerfileDiscovery = useDockerfileDiscovery(dockerfilePaths);

  const fastPath = useFastPathOrchestration({
    clusterName,
    namespace,
    appName: orchestration.localAppName || appName,
    subscriptionId,
    resourceGroup,
    tenantId,
    selectedRepo: orchestration.selectedRepo,
    containerConfig: localContainerConfig.config,
    identityId: orchestration.identityId,
  });

  const handleFastPathDeploy = useCallback(() => {
    if (!dockerfileDiscovery.selection) return;
    fastPath.handleDeploy({
      selection: dockerfileDiscovery.selection,
      withAsyncAgent: pathChoice === 'fast-with-ai',
    });
  }, [dockerfileDiscovery.selection, fastPath.handleDeploy, pathChoice]);

  // Latch first successful auth to avoid cross-tree flicker regression.
  const authAdvancedRef = useRef(false);
  const setAuthCompletedRef = useRef(orchestration.pipeline.setAuthCompleted);
  useEffect(() => {
    setAuthCompletedRef.current = orchestration.pipeline.setAuthCompleted;
  }, [orchestration.pipeline.setAuthCompleted]);

  const deploymentState = orchestration.pipeline.state.deploymentState;
  const isAuthenticated = orchestration.gitHubAuth.authState.isAuthenticated;
  useEffect(() => {
    if (
      !authAdvancedRef.current &&
      deploymentState === 'GitHubAuthorizationNeeded' &&
      isAuthenticated
    ) {
      authAdvancedRef.current = true;
      setAuthCompletedRef.current();
    }
  }, [deploymentState, isAuthenticated]);

  return (
    <GitHubPipelineWizardPure
      clusterName={clusterName}
      namespace={namespace}
      subscriptionId={subscriptionId}
      resourceGroup={resourceGroup}
      onClose={onClose}
      onCancel={onCancel}
      onViewDeployment={onViewDeployment}
      orchestration={orchestration}
      fastPath={fastPath}
      dockerfileDiscovery={dockerfileDiscovery}
      localContainerConfig={localContainerConfig}
      isManagedNamespace={isManagedNamespace}
      azureRbacEnabled={azureRbacEnabled}
      pathChoice={pathChoice}
      onPathChoiceChange={setPathChoice}
      onFastPathDeploy={handleFastPathDeploy}
    />
  );
}
