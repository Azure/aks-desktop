// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContainerConfig, createValidConfig } from '../__fixtures__/pipelineConfig';
import { SCHEMA_VERSION, STORAGE_KEY_PREFIX } from '../constants';
import type { PipelineDeploymentState, PipelineState } from '../types';

const mocks = vi.hoisted(() => ({
  octokit: {},
  getRepoSetupStatus: vi.fn(),
  createSetupPR: vi.fn(),
  createPipelineSecrets: vi.fn(),
  triggerCopilotAgent: vi.fn(),
  checkAppInstallation: vi.fn(),
  checkRepoReadiness: vi.fn(),
  merged: false,
  prPollingHook: vi.fn(),
  identitySetupHook: vi.fn(),
  ensureIdentityWithRoles: vi.fn(),
  getPullRequest: vi.fn(),
  getStatusChecks: vi.fn(),
  resolveManagedIdentityByClientId: vi.fn(),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { ResourceClasses: { Namespace: { useGet: () => [null] } } },
}));
vi.mock('../GitHubAuthContext', () => ({
  useGitHubAuthContext: () => ({
    octokit: mocks.octokit,
    authState: { isAuthenticated: true, isRestoring: false },
  }),
}));
vi.mock('../../../utils/github/github-api', () => ({
  checkAppInstallation: mocks.checkAppInstallation,
  checkRepoReadiness: mocks.checkRepoReadiness,
  dispatchWorkflow: vi.fn(),
  getPullRequest: mocks.getPullRequest,
  getStatusChecks: mocks.getStatusChecks,
}));
vi.mock('../utils/pipelineOrchestration', () => ({
  createSetupPR: mocks.createSetupPR,
  createPipelineSecrets: mocks.createPipelineSecrets,
  triggerCopilotAgent: mocks.triggerCopilotAgent,
}));
vi.mock('../utils/repoSetupStatus', () => ({
  getRepoSetupStatus: mocks.getRepoSetupStatus,
}));
vi.mock('./usePRPolling', () => ({
  usePRPolling: (...args: unknown[]) => mocks.prPollingHook(...args),
}));
vi.mock('./useAgentPRDiscovery', () => ({
  useAgentPRDiscovery: () => ({}),
}));
vi.mock('./useAgentWorkflowProgress', () => ({
  useAgentWorkflowProgress: () => ({}),
}));
vi.mock('./useWorkflowPolling', () => ({
  useWorkflowPolling: () => ({}),
}));
vi.mock('./useDeploymentHealth', () => ({
  useDeploymentHealth: () => ({}),
}));
vi.mock('./useWorkloadIdentitySetup', () => ({
  useWorkloadIdentitySetup: (...args: unknown[]) => mocks.identitySetupHook(...args),
}));
vi.mock('../../../utils/azure/identityWithRoles', () => ({
  ensureIdentityWithRoles: mocks.ensureIdentityWithRoles,
}));
vi.mock('../../../utils/azure/az-identity', () => ({
  resolveManagedIdentityByClientId: mocks.resolveManagedIdentityByClientId,
}));
vi.mock('../../../utils/azure/az-federation', () => ({
  createFederatedCredential: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('./usePipelineAnnotationSync', () => ({
  ANNOTATION_WORKLOAD_IDENTITY: 'aks-project/workload-identity',
  usePipelineAnnotationSync: () => {},
}));

import { useGitHubPipelineOrchestration } from './useGitHubPipelineOrchestration';

const config = createValidConfig({
  acrResourceId:
    '/subscriptions/sub-789/resourceGroups/my-rg/providers/Microsoft.ContainerRegistry/registries/myregistry',
  acrLoginServer: 'myregistry.azurecr.io',
});
const readiness = {
  hasSetupWorkflow: true,
  hasAgentConfig: true,
  hasDeployWorkflow: false,
  dockerfilePaths: [],
};
const props = {
  ...config,
  initialRepo: config.repo,
};

function renderPipeline(
  deploymentState: PipelineDeploymentState = 'ReadyForSetup',
  overrides: Partial<PipelineState> = {},
  hookProps: Partial<Parameters<typeof useGitHubPipelineOrchestration>[0]> = {}
) {
  localStorage.setItem(
    `${STORAGE_KEY_PREFIX}${config.repo.owner}/${config.repo.repo}`,
    JSON.stringify({
      __schemaVersion: SCHEMA_VERSION,
      deploymentState,
      config,
      repoReadiness: readiness,
      lastSuccessfulState: 'ReadyForSetup',
      ...overrides,
    })
  );
  return renderHook(
    (currentProps: typeof hookProps) =>
      useGitHubPipelineOrchestration({ ...props, ...currentProps }),
    { initialProps: hookProps }
  );
}

async function submitReview(result: ReturnType<typeof renderPipeline>['result']) {
  await waitFor(() =>
    expect(['current', 'obsolete']).toContain(result.current.pipeline.state.setupStatus)
  );
  await act(async () => result.current.handleCreateSetupPR());
}

describe('useGitHubPipelineOrchestration setup upgrades', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.merged = false;
    mocks.prPollingHook.mockImplementation(() => ({ isMerged: mocks.merged }));
    mocks.identitySetupHook.mockImplementation(() => ({
      status: 'done',
      result: { clientId: config.identityId, warnings: [] },
    }));
    mocks.resolveManagedIdentityByClientId.mockResolvedValue({
      clientId: config.identityId,
      identityName: 'saved-identity',
      identityResourceGroup: 'identity-rg',
    });
    mocks.getRepoSetupStatus.mockReset().mockResolvedValue({ isCurrent: false });
    mocks.checkAppInstallation.mockResolvedValue({ installed: true });
    mocks.checkRepoReadiness.mockResolvedValue(readiness);
    mocks.createSetupPR.mockReset().mockResolvedValue({
      url: 'https://github.com/testuser/my-repo/pull/42',
      number: 42,
      merged: false,
    });
    mocks.createPipelineSecrets.mockResolvedValue(undefined);
    mocks.triggerCopilotAgent.mockResolvedValue({
      url: 'https://github.com/testuser/my-repo/issues/43',
      number: 43,
    });
  });

  it('does not take the existing-filenames bypass for obsolete setup during repo checking', async () => {
    const { result } = renderPipeline('Configured');
    await waitFor(() => expect(result.current.pipeline.state.deploymentState).toBe('AcrSelection'));
    expect(mocks.getRepoSetupStatus).toHaveBeenCalledWith(mocks.octokit, config);
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
  });

  it('requires explicit fresh identity setup for a current bundle before skipping its duplicate PR', async () => {
    let completed = false;
    mocks.identitySetupHook.mockImplementation(() => ({
      status: completed ? 'done' : 'idle',
      result: completed ? { clientId: config.identityId, warnings: [] } : null,
    }));
    mocks.getRepoSetupStatus.mockResolvedValue({ isCurrent: true });
    const { result, rerender } = renderPipeline('Configured');
    await waitFor(() =>
      expect(result.current.pipeline.state.deploymentState).toBe('WorkloadIdentitySetup')
    );
    expect(mocks.createPipelineSecrets).not.toHaveBeenCalled();
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
    completed = true;
    rerender();
    await submitReview(result);
    await waitFor(() => expect(result.current.pipeline.state.deploymentState).toBe('AgentRunning'));
    expect(mocks.createSetupPR).not.toHaveBeenCalled();
    expect(mocks.triggerCopilotAgent).toHaveBeenCalledTimes(1);
  });

  it.each(['ReadyForSetup', 'AgentTaskCreating'] as const)(
    'does not treat a saved current %s as current-session permission proof',
    async deploymentState => {
      mocks.identitySetupHook.mockReturnValue({ status: 'idle', result: null });
      mocks.getRepoSetupStatus.mockResolvedValue({ isCurrent: true });
      const { result } = renderPipeline(deploymentState, { setupStatus: 'current' });
      await waitFor(() =>
        expect(result.current.pipeline.state.deploymentState).toBe('WorkloadIdentitySetup')
      );
      expect(mocks.getRepoSetupStatus).not.toHaveBeenCalled();
      expect(mocks.createPipelineSecrets).not.toHaveBeenCalled();
      expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
    }
  );

  it.each(['fast', 'fast-with-ai', null] as const)(
    'requires fresh permissions for a resumed Dockerfile review on path %s',
    async pathChoice => {
      let completed = false;
      mocks.identitySetupHook.mockImplementation(() => ({
        status: completed ? 'done' : 'idle',
        result: completed ? { clientId: config.identityId, warnings: [] } : null,
      }));
      const { result, rerender } = renderPipeline(
        'ReadyForSetup',
        { repoReadiness: { ...readiness, dockerfilePaths: ['Dockerfile'] } },
        { pathChoice }
      );
      await waitFor(() =>
        expect(result.current.pipeline.state.deploymentState).toBe('WorkloadIdentitySetup')
      );
      expect(result.current.identityReady).toBe(false);
      expect(mocks.createPipelineSecrets).not.toHaveBeenCalled();
      completed = true;
      rerender({ pathChoice });
      await waitFor(() =>
        expect(result.current.pipeline.state.deploymentState).toBe('ReadyForSetup')
      );
      expect(result.current.identityReady).toBe(true);
      expect(mocks.getRepoSetupStatus).not.toHaveBeenCalled();
      expect(mocks.createSetupPR).not.toHaveBeenCalled();
      expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
    }
  );

  it.each(['deleted identity', 'revoked roles', 'unacknowledged pull'] as const)(
    'keeps resumed fast paths blocked after %s verification fails',
    async failure => {
      const { useWorkloadIdentitySetup } = await vi.importActual<
        typeof import('./useWorkloadIdentitySetup')
      >('./useWorkloadIdentitySetup');
      mocks.identitySetupHook.mockImplementation(useWorkloadIdentitySetup);
      if (failure === 'deleted identity') {
        mocks.resolveManagedIdentityByClientId.mockRejectedValue(new Error('Identity not found'));
      } else if (failure === 'revoked roles') {
        mocks.ensureIdentityWithRoles.mockRejectedValueOnce(new Error('Role assignment forbidden'));
      } else {
        mocks.ensureIdentityWithRoles.mockResolvedValueOnce({
          clientId: config.identityId,
          principalId: 'principal',
          warnings: [],
          servicePrincipalPullRequired: true,
        });
      }
      const { result } = renderPipeline(
        'ReadyForSetup',
        { repoReadiness: { ...readiness, dockerfilePaths: ['Dockerfile'] } },
        { pathChoice: 'fast' }
      );
      await waitFor(() =>
        expect(result.current.pipeline.state.deploymentState).toBe('WorkloadIdentitySetup')
      );
      await act(async () =>
        result.current.identitySetup.setupWorkloadIdentity({
          ...config,
          projectName: 'project',
          identityResourceGroup: 'identity-rg',
          isManagedNamespace: false,
          azureRbacEnabled: true,
        })
      );
      expect(result.current.identitySetup.status).toBe('error');
      expect(result.current.identityReady).toBe(false);
      expect(result.current.pipeline.state.deploymentState).toBe('WorkloadIdentitySetup');
      expect(mocks.getRepoSetupStatus).not.toHaveBeenCalled();
      expect(mocks.createPipelineSecrets).not.toHaveBeenCalled();
      expect(mocks.createSetupPR).not.toHaveBeenCalled();
      expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
    }
  );

  it('invalidates successful fast-path permission proof when the selected registry changes', async () => {
    const { useWorkloadIdentitySetup } = await vi.importActual<
      typeof import('./useWorkloadIdentitySetup')
    >('./useWorkloadIdentitySetup');
    mocks.identitySetupHook.mockImplementation(useWorkloadIdentitySetup);
    mocks.ensureIdentityWithRoles.mockResolvedValue({
      clientId: config.identityId,
      principalId: 'principal',
      warnings: [],
    });
    const { result } = renderPipeline(
      'ReadyForSetup',
      { repoReadiness: { ...readiness, dockerfilePaths: ['Dockerfile'] } },
      { pathChoice: 'fast' }
    );
    await act(async () =>
      result.current.identitySetup.setupWorkloadIdentity({
        ...config,
        projectName: 'project',
        identityResourceGroup: 'identity-rg',
        isManagedNamespace: false,
        azureRbacEnabled: true,
      })
    );
    await waitFor(() => expect(result.current.identityReady).toBe(true));
    act(() => result.current.pipeline.updateConfig({ acrLoginServer: 'other.azurecr.io' }));
    await waitFor(() => expect(result.current.identityReady).toBe(false));
    expect(result.current.pipeline.state.deploymentState).toBe('WorkloadIdentitySetup');
    expect(mocks.getRepoSetupStatus).not.toHaveBeenCalled();
    expect(mocks.createPipelineSecrets).not.toHaveBeenCalled();
  });

  it.each(['agent', 'fast', 'fast-with-ai'] as const)(
    'recovers ID-only saved reviews and retries on path %s before any secret writes',
    async pathChoice => {
      mocks.identitySetupHook.mockReturnValue({ status: 'idle', result: null });
      const savedConfig = {
        ...config,
        acrResourceId: 'registry-id',
        acrLoginServer: undefined,
        buildArguments: { MODE: 'prod' },
      };
      for (const deploymentState of ['ReadyForSetup', 'Failed', 'Configured'] as const) {
        const { result, unmount } = renderPipeline(
          deploymentState,
          {
            config: savedConfig,
            setupStatus: 'current',
            error: deploymentState === 'Failed' ? 'Missing registry login server' : null,
          },
          { pathChoice }
        );
        if (deploymentState === 'Failed') act(() => result.current.pipeline.retry());
        await waitFor(() =>
          expect(result.current.pipeline.state.deploymentState).toBe('AcrSelection')
        );
        expect(result.current.pipeline.state.config).toEqual(savedConfig);
        act(() =>
          result.current.pipeline.updateConfig({ acrLoginServer: 'myregistry.azurecr.io' })
        );
        act(() => result.current.pipeline.setAcrCompleted());
        expect(result.current.pipeline.state.deploymentState).toBe('WorkloadIdentitySetup');
        expect(result.current.pipeline.state.config).toEqual({
          ...savedConfig,
          acrLoginServer: 'myregistry.azurecr.io',
        });
        expect(mocks.createPipelineSecrets).not.toHaveBeenCalled();
        expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
        unmount();
      }
    }
  );

  it('preserves a safely created ID-only setup PR until merge, then recovers registry selection', async () => {
    mocks.identitySetupHook.mockReturnValue({ status: 'idle', result: null });
    const setupPr = { url: 'https://github.com/test/repo/pull/42', number: 42, merged: false };
    const savedConfig = { ...config, acrLoginServer: undefined };
    const { result, rerender } = renderPipeline('SetupPRAwaitingMerge', {
      setupPr,
      config: savedConfig,
    });
    expect(result.current.pipeline.state.deploymentState).toBe('SetupPRAwaitingMerge');
    expect(result.current.pipeline.state.setupPr).toEqual(setupPr);
    expect(mocks.createPipelineSecrets).not.toHaveBeenCalled();
    mocks.merged = true;
    rerender();
    await waitFor(() => expect(result.current.pipeline.state.deploymentState).toBe('AcrSelection'));
    expect(result.current.pipeline.state.setupPr).toEqual({ ...setupPr, merged: true });
    expect(result.current.pipeline.state.config).toEqual(savedConfig);
    expect(mocks.createPipelineSecrets).not.toHaveBeenCalled();
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
  });

  it.each(['revoked roles', 'unacknowledged service-principal pull'] as const)(
    'blocks the current-bundle shortcut with %s',
    async failure => {
      const { useWorkloadIdentitySetup } = await vi.importActual<
        typeof import('./useWorkloadIdentitySetup')
      >('./useWorkloadIdentitySetup');
      mocks.identitySetupHook.mockImplementation(useWorkloadIdentitySetup);
      mocks.getRepoSetupStatus.mockResolvedValue({ isCurrent: true });
      if (failure === 'revoked roles') {
        mocks.ensureIdentityWithRoles.mockRejectedValueOnce(new Error('Role assignment forbidden'));
      } else {
        mocks.ensureIdentityWithRoles.mockResolvedValueOnce({
          clientId: config.identityId,
          principalId: 'principal',
          warnings: [],
          servicePrincipalPullRequired: true,
        });
      }
      const { result } = renderPipeline('Configured');
      await waitFor(() =>
        expect(result.current.pipeline.state.deploymentState).toBe('WorkloadIdentitySetup')
      );
      await act(async () =>
        result.current.identitySetup.setupWorkloadIdentity({
          ...config,
          projectName: 'project',
          identityResourceGroup: 'identity-rg',
          isManagedNamespace: false,
        })
      );
      expect(result.current.identitySetup.status).toBe('error');
      expect(result.current.pipeline.state.deploymentState).toBe('WorkloadIdentitySetup');
      expect(mocks.createPipelineSecrets).not.toHaveBeenCalled();
      expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
    }
  );

  it('retains explicit new-identity completion through adoption but never through reload', async () => {
    const { useWorkloadIdentitySetup } = await vi.importActual<
      typeof import('./useWorkloadIdentitySetup')
    >('./useWorkloadIdentitySetup');
    mocks.identitySetupHook.mockImplementation(useWorkloadIdentitySetup);
    mocks.ensureIdentityWithRoles.mockResolvedValue({
      clientId: config.identityId,
      principalId: 'principal',
      warnings: [],
    });
    mocks.getRepoSetupStatus.mockResolvedValue({ isCurrent: true });
    const { result, unmount } = renderPipeline('AcrSelection', {
      config: { ...config, identityId: '' },
    });
    act(() => result.current.pipeline.setAcrCompleted());
    await act(async () =>
      result.current.identitySetup.setupWorkloadIdentity({
        ...config,
        projectName: 'project',
        identityResourceGroup: 'identity-rg',
        isManagedNamespace: false,
      })
    );
    await waitFor(() =>
      expect(result.current.pipeline.state.deploymentState).toBe('ReadyForSetup')
    );
    expect(result.current.identitySetup.status).toBe('done');
    expect(result.current.pipeline.state.config?.identityId).toBe(config.identityId);
    await submitReview(result);
    await waitFor(() => expect(result.current.pipeline.state.deploymentState).toBe('AgentRunning'));
    expect(mocks.triggerCopilotAgent).toHaveBeenCalledTimes(1);
    unmount();
    const resumed = renderPipeline('ReadyForSetup', { setupStatus: 'current' });
    await waitFor(() =>
      expect(resumed.result.current.pipeline.state.deploymentState).toBe('WorkloadIdentitySetup')
    );
    expect(mocks.ensureIdentityWithRoles).toHaveBeenCalledTimes(1);
    expect(mocks.triggerCopilotAgent).toHaveBeenCalledTimes(1);
  });

  it('opens an explicit upgrade PR and waits for both merge and current default-branch setup', async () => {
    const { result, rerender } = renderPipeline();
    await submitReview(result);
    expect(mocks.createSetupPR).toHaveBeenCalledWith(mocks.octokit, config);
    expect(result.current.pipeline.state.deploymentState).toBe('SetupPRAwaitingMerge');
    expect(result.current.pipeline.state.setupPr.merged).toBe(false);
    expect(mocks.createPipelineSecrets).not.toHaveBeenCalled();
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();

    mocks.getRepoSetupStatus.mockResolvedValue({ isCurrent: true });
    rerender();
    expect(result.current.pipeline.state.deploymentState).toBe('SetupPRAwaitingMerge');
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();

    mocks.merged = true;
    rerender();
    await waitFor(() => expect(result.current.pipeline.state.deploymentState).toBe('AgentRunning'));
    expect(mocks.createSetupPR).toHaveBeenCalledTimes(1);
    expect(mocks.triggerCopilotAgent).toHaveBeenCalledTimes(1);
  });

  it('does not trigger after merge if the upgrade is still absent or obsolete', async () => {
    const { result, rerender } = renderPipeline();
    await submitReview(result);
    mocks.merged = true;
    rerender();
    await waitFor(() =>
      expect(result.current.pipeline.state.deploymentState).toBe('ReadyForSetup')
    );
    expect(mocks.createPipelineSecrets).not.toHaveBeenCalled();
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
  });

  it('rechecks persisted AgentTaskCreating sessions before creating secrets or assigning the agent', async () => {
    const { result } = renderPipeline('AgentTaskCreating');
    await waitFor(() =>
      expect(result.current.pipeline.state.deploymentState).toBe('ReadyForSetup')
    );
    expect(mocks.createPipelineSecrets).not.toHaveBeenCalled();
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
  });

  it('skips setup PR creation when the current bundle is already committed', async () => {
    mocks.getRepoSetupStatus.mockResolvedValue({ isCurrent: true });
    const { result } = renderPipeline();
    await submitReview(result);
    await waitFor(() => expect(result.current.pipeline.state.deploymentState).toBe('AgentRunning'));
    expect(mocks.createSetupPR).not.toHaveBeenCalled();
    expect(mocks.triggerCopilotAgent).toHaveBeenCalledTimes(1);
  });

  it('will not submit an unverified review even if setup files exist', async () => {
    let finishVerification!: (value: { isCurrent: boolean }) => void;
    mocks.getRepoSetupStatus.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishVerification = resolve;
        })
    );
    const { result } = renderPipeline();
    expect(result.current.pipeline.state.setupStatus).toBe('verifying');
    await act(async () => result.current.handleCreateSetupPR());
    expect(mocks.createSetupPR).not.toHaveBeenCalled();
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.getRepoSetupStatus).toHaveBeenCalledOnce());
    await act(async () => finishVerification({ isCurrent: false }));
    expect(result.current.pipeline.state.setupStatus).toBe('obsolete');
  });

  it('creates an upgrade instead of triggering when previously current setup becomes obsolete', async () => {
    mocks.getRepoSetupStatus
      .mockResolvedValueOnce({ isCurrent: true })
      .mockResolvedValueOnce({ isCurrent: false });
    const { result } = renderPipeline();
    await submitReview(result);
    expect(result.current.pipeline.state.setupStatus).toBe('obsolete');
    expect(result.current.pipeline.state.deploymentState).toBe('SetupPRAwaitingMerge');
    expect(mocks.createSetupPR).toHaveBeenCalledOnce();
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
  });

  it.each([
    'Setup lookup forbidden',
    'Repository branch changed during setup verification. Please retry.',
  ])('reports verification error without offering an upgrade: %s', async message => {
    mocks.getRepoSetupStatus.mockRejectedValueOnce(new Error(message));
    const { result } = renderPipeline();
    await waitFor(() => expect(result.current.pipeline.state.deploymentState).toBe('Failed'));
    expect(result.current.pipeline.state.error).toBe(message);
    expect(result.current.pipeline.state.setupStatus).toBe('unknown');
    expect(mocks.createSetupPR).not.toHaveBeenCalled();
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
  });

  it('reports setup verification failures during initial repo checking rather than bypassing', async () => {
    mocks.getRepoSetupStatus.mockRejectedValueOnce(new Error('Repo setup lookup failed'));
    const { result } = renderPipeline('Configured');
    await waitFor(() => expect(result.current.pipeline.state.deploymentState).toBe('Failed'));
    expect(result.current.pipeline.state.error).toBe('Repo setup lookup failed');
    expect(mocks.createSetupPR).not.toHaveBeenCalled();
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
  });

  it('reports upgrade PR creation failures through the caller-visible pipeline error', async () => {
    mocks.createSetupPR.mockRejectedValueOnce(new Error('Upgrade write failed'));
    const { result } = renderPipeline();
    await submitReview(result);
    expect(result.current.pipeline.state.deploymentState).toBe('Failed');
    expect(result.current.pipeline.state.error).toBe('Upgrade write failed');
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
  });

  it.each([
    'Verification unavailable',
    'Repository branch changed during setup verification. Please retry.',
  ])('fails closed at the final agent gate for verification error: %s', async message => {
    mocks.getRepoSetupStatus.mockRejectedValueOnce(new Error(message));
    const { result } = renderPipeline('AgentTaskCreating');
    await waitFor(() => expect(result.current.pipeline.state.deploymentState).toBe('Failed'));
    expect(result.current.pipeline.state.error).toBe(message);
    expect(result.current.pipeline.state.setupStatus).toBe('unknown');
    expect(mocks.createPipelineSecrets).not.toHaveBeenCalled();
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
  });

  it('keeps a replacement PR awaiting merge after the previous merged PR failed verification', async () => {
    const { usePRPolling } = await vi.importActual<typeof import('./usePRPolling')>(
      './usePRPolling'
    );
    mocks.prPollingHook.mockImplementation(usePRPolling);
    mocks.getPullRequest.mockResolvedValue({
      state: 'closed',
      merged: true,
      mergeable: true,
      headSha: 'old',
    });
    const { result } = renderPipeline('SetupPRAwaitingMerge', {
      setupPr: { number: 41, url: 'https://github.com/testuser/my-repo/pull/41', merged: false },
    });
    await waitFor(() => expect(result.current.pipeline.state.setupStatus).toBe('obsolete'));
    expect(result.current.pipeline.state.deploymentState).toBe('ReadyForSetup');
    let resolveReplacement!: (value: object) => void;
    mocks.getPullRequest.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveReplacement = resolve;
        })
    );
    await submitReview(result);
    expect(result.current.pipeline.state.setupPr.number).toBe(42);
    expect(result.current.pipeline.state.deploymentState).toBe('SetupPRAwaitingMerge');
    await act(async () =>
      resolveReplacement({
        state: 'open',
        merged: false,
        mergeable: true,
        headSha: 'new',
      })
    );
    expect(result.current.pipeline.state.deploymentState).toBe('SetupPRAwaitingMerge');
    expect(result.current.pipeline.state.setupPr.merged).toBe(false);
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
  });

  it('requires user-confirmed identity setup for registry B instead of accepting registry A completion', async () => {
    const { useWorkloadIdentitySetup } = await vi.importActual<
      typeof import('./useWorkloadIdentitySetup')
    >('./useWorkloadIdentitySetup');
    mocks.identitySetupHook.mockImplementation(useWorkloadIdentitySetup);
    mocks.ensureIdentityWithRoles.mockResolvedValue({
      clientId: config.identityId,
      principalId: 'principal',
      tenantId: config.tenantId,
      warnings: [],
    });
    const registryA =
      '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/a';
    const registryB = registryA.replace('/a', '/b');
    const { result } = renderPipeline('AcrSelection', {
      config: { ...config, acrResourceId: registryA },
    });
    const setupConfig = {
      ...config,
      identityResourceGroup: 'identity-rg',
      projectName: 'project',
      isManagedNamespace: false as const,
      acrResourceId: registryA,
    };
    act(() => result.current.pipeline.setAcrCompleted());
    await act(async () => result.current.identitySetup.setupWorkloadIdentity(setupConfig));
    await waitFor(() =>
      expect(result.current.pipeline.state.deploymentState).toBe('ReadyForSetup')
    );
    expect(result.current.identitySetup.status).toBe('done');

    act(() => result.current.pipeline.updateConfig({ acrResourceId: registryB }));
    expect(result.current.pipeline.state.deploymentState).toBe('WorkloadIdentitySetup');
    expect(result.current.identitySetup.status).toBe('idle');
    expect(result.current.identitySetup.result).toBeNull();
    expect(mocks.ensureIdentityWithRoles).toHaveBeenCalledTimes(1);
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();

    let finishPermissions!: (value: object) => void;
    mocks.ensureIdentityWithRoles.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishPermissions = resolve;
        })
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.identitySetup.setupWorkloadIdentity({
        ...setupConfig,
        acrResourceId: registryB,
      });
    });
    expect(result.current.pipeline.state.deploymentState).toBe('WorkloadIdentitySetup');
    expect(mocks.ensureIdentityWithRoles).toHaveBeenLastCalledWith(
      expect.objectContaining({
        acrResourceId: registryB,
        isPipeline: true,
      })
    );
    await act(async () => {
      finishPermissions({
        clientId: config.identityId,
        principalId: 'principal',
        tenantId: config.tenantId,
        warnings: [],
      });
      await pending;
    });
    expect(result.current.pipeline.state.deploymentState).toBe('ReadyForSetup');
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
  });

  it.each(['fast', 'fast-with-ai', null] as const)(
    'does not read agent setup or fail the shared review on path %s with Dockerfiles',
    async pathChoice => {
      vi.useFakeTimers();
      mocks.getRepoSetupStatus.mockRejectedValue(new Error('Contents forbidden'));
      const { result } = renderPipeline(
        'ReadyForSetup',
        { repoReadiness: { ...readiness, dockerfilePaths: ['Dockerfile'] } },
        { pathChoice }
      );
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(mocks.getRepoSetupStatus).not.toHaveBeenCalled();
      expect(result.current.pipeline.state.deploymentState).toBe('ReadyForSetup');
      expect(result.current.pipeline.state.error).toBeNull();
    }
  );

  it('does not perform an agent setup read before Dockerfile path selection during repo checking', async () => {
    mocks.getRepoSetupStatus.mockRejectedValue(new Error('Contents forbidden'));
    mocks.checkRepoReadiness.mockResolvedValue({
      ...readiness,
      dockerfilePaths: ['Dockerfile'],
    });
    const { result } = renderPipeline('Configured');
    await waitFor(() => expect(result.current.pipeline.state.deploymentState).toBe('AcrSelection'));
    expect(mocks.getRepoSetupStatus).not.toHaveBeenCalled();
    expect(result.current.pipeline.state.error).toBeNull();
  });

  it('starts verification only after the agent path is selected for a Dockerfile repository', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderPipeline('ReadyForSetup', {
      repoReadiness: { ...readiness, dockerfilePaths: ['Dockerfile'] },
    });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(mocks.getRepoSetupStatus).not.toHaveBeenCalled();
    rerender({ pathChoice: 'agent' });
    expect(result.current.pipeline.state.setupStatus).toBe('verifying');
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(mocks.getRepoSetupStatus).toHaveBeenCalledOnce();
    expect(result.current.pipeline.state.setupStatus).toBe('obsolete');
  });

  it('still revalidates a resumed agent task when its repository contains a Dockerfile', async () => {
    mocks.getRepoSetupStatus.mockResolvedValue({ isCurrent: true });
    const { result } = renderPipeline('AgentTaskCreating', {
      repoReadiness: { ...readiness, dockerfilePaths: ['Dockerfile'] },
    });
    await waitFor(() => expect(result.current.pipeline.state.deploymentState).toBe('AgentRunning'));
    expect(mocks.getRepoSetupStatus).toHaveBeenCalledOnce();
    expect(mocks.triggerCopilotAgent).toHaveBeenCalledOnce();
  });

  it('keeps the repo-name default only in the draft and allows clearing it without refilling', async () => {
    vi.useFakeTimers();
    const { result } = renderPipeline(
      'ReadyForSetup',
      { config: { ...config, appName: '' } },
      { appName: '' }
    );
    expect(result.current.localAppName).toBe(config.repo.repo);
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(mocks.getRepoSetupStatus).toHaveBeenCalledWith(
      mocks.octokit,
      expect.objectContaining({ appName: config.repo.repo })
    );
    expect(result.current.pipeline.state.config?.appName).toBe('');
    act(() => result.current.setLocalAppName(''));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(result.current.localAppName).toBe('');
    expect(result.current.pipeline.state.setupStatus).toBe('unknown');
    expect(result.current.pipeline.state.config?.appName).toBe('');
    await act(async () => result.current.handleCreateSetupPR());
    expect(mocks.createSetupPR).not.toHaveBeenCalled();
    expect(mocks.getRepoSetupStatus).toHaveBeenCalledOnce();
  });

  it('submits the initial repo-name default even though it has not been persisted', async () => {
    const { result } = renderPipeline(
      'ReadyForSetup',
      { config: { ...config, appName: '' } },
      { appName: '' }
    );
    await submitReview(result);
    expect(mocks.createSetupPR).toHaveBeenCalledWith(
      mocks.octokit,
      expect.objectContaining({ appName: config.repo.repo })
    );
    expect(result.current.pipeline.state.config?.appName).toBe(config.repo.repo);
  });

  it('debounces name and container edits into one verification of the latest draft', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderPipeline();
    for (const appName of ['a', 'ab', 'abc']) {
      act(() => result.current.setLocalAppName(appName));
      rerender({ containerConfig: createContainerConfig({ appName, targetPort: 8081 }) });
      await act(async () => vi.advanceTimersByTimeAsync(100));
    }
    expect(mocks.getRepoSetupStatus).not.toHaveBeenCalled();
    expect(result.current.pipeline.state.setupStatus).toBe('verifying');
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(mocks.getRepoSetupStatus).toHaveBeenCalledOnce();
    expect(mocks.getRepoSetupStatus).toHaveBeenCalledWith(
      mocks.octokit,
      expect.objectContaining({
        appName: 'abc',
        containerConfig: expect.objectContaining({ appName: 'abc', targetPort: 8081 }),
      })
    );
    expect(result.current.pipeline.state.config?.appName).toBe(config.appName);
    await act(async () => result.current.handleCreateSetupPR());
    expect(mocks.getRepoSetupStatus).toHaveBeenCalledTimes(2);
    expect(mocks.createSetupPR).toHaveBeenCalledWith(
      mocks.octokit,
      expect.objectContaining({
        appName: 'abc',
        containerConfig: expect.objectContaining({ targetPort: 8081 }),
      })
    );
  });

  it.each(['config', 'repo', 'token', 'path'] as const)(
    'ignores a verification response after the %s context changes',
    async change => {
      vi.useFakeTimers();
      let finish!: (value: { isCurrent: boolean }) => void;
      mocks.getRepoSetupStatus.mockImplementationOnce(
        () => new Promise(resolve => (finish = resolve))
      );
      const { result, rerender } = renderPipeline();
      await act(async () => vi.advanceTimersByTimeAsync(350));
      if (change === 'config') {
        act(() => result.current.pipeline.updateConfig({ namespace: 'changed-namespace' }));
      } else if (change === 'repo') {
        act(() => result.current.setSelectedRepo({ ...config.repo, repo: 'other-repo' }));
      } else if (change === 'token') {
        mocks.octokit = {};
        rerender({});
      } else {
        rerender({ pathChoice: 'fast' });
      }
      await act(async () => finish({ isCurrent: true }));
      expect(result.current.pipeline.state.setupStatus).not.toBe('current');
      expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
    }
  );

  it('does not create a PR from a submit verification after the draft changes', async () => {
    vi.useFakeTimers();
    const { result } = renderPipeline();
    await act(async () => vi.advanceTimersByTimeAsync(350));
    let finish!: (value: { isCurrent: boolean }) => void;
    mocks.getRepoSetupStatus.mockImplementationOnce(
      () => new Promise(resolve => (finish = resolve))
    );
    let submitting!: Promise<void>;
    act(() => {
      submitting = result.current.handleCreateSetupPR();
    });
    act(() => result.current.setLocalAppName('new-draft'));
    await act(async () => {
      finish({ isCurrent: false });
      await submitting;
    });
    expect(mocks.createSetupPR).not.toHaveBeenCalled();
    expect(mocks.triggerCopilotAgent).not.toHaveBeenCalled();
    expect(result.current.pipeline.state.deploymentState).toBe('ReadyForSetup');
  });

  it('cancels the debounce when unmounted and does not refetch for identical container values', async () => {
    vi.useFakeTimers();
    const containerConfig = createContainerConfig();
    const { rerender, unmount } = renderPipeline('ReadyForSetup', {}, { containerConfig });
    await act(async () => vi.advanceTimersByTimeAsync(350));
    rerender({ containerConfig: { ...containerConfig } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(mocks.getRepoSetupStatus).toHaveBeenCalledOnce();
    rerender({ containerConfig: { ...containerConfig, targetPort: 8081 } });
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(mocks.getRepoSetupStatus).toHaveBeenCalledOnce();
  });
});
