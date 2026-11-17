// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContainerConfig } from '../__fixtures__/pipelineConfig';

// --- Mock sub-hooks and utilities ---

const mockOctokit = { request: vi.fn() } as never;

vi.mock('../GitHubAuthContext', () => ({
  useGitHubAuthContext: () => ({
    octokit: mockOctokit,
    authState: { isAuthenticated: true, isRestoring: false },
  }),
}));

const mockCreatePipelineSecrets = vi.fn().mockResolvedValue(undefined);
vi.mock('../utils/pipelineOrchestration', () => ({
  createPipelineSecrets: (...args: unknown[]) => mockCreatePipelineSecrets(...args),
}));

const mockCreateFastPathPR = vi.fn().mockResolvedValue({
  url: 'https://github.com/test/repo/pull/1',
  number: 1,
  merged: false,
});
const mockTriggerAsyncAgentReview = vi
  .fn()
  .mockResolvedValue('https://github.com/test/repo/issues/2');
vi.mock('../utils/fastPathOrchestration', () => ({
  createFastPathPR: (...args: unknown[]) => mockCreateFastPathPR(...args),
  triggerAsyncAgentReview: (...args: unknown[]) => mockTriggerAsyncAgentReview(...args),
}));

const mockGetRepoSetupStatus = vi.fn().mockResolvedValue({
  isCurrent: true,
  hasSetupWorkflow: true,
  hasAgentConfig: true,
});
vi.mock('../utils/repoSetupStatus', () => ({
  getRepoSetupStatus: (...args: unknown[]) => mockGetRepoSetupStatus(...args),
}));

const mockDispatchWorkflow = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../utils/github/github-api', () => ({
  dispatchWorkflow: (...args: unknown[]) => mockDispatchWorkflow(...args),
}));

// PR polling mock — returns isMerged state controlled by test
let prPollingMerged = false;
vi.mock('./usePRPolling', () => ({
  usePRPolling: () => ({
    isMerged: prPollingMerged,
    error: null,
  }),
}));

// Workflow polling mock
let workflowConclusion: string | null = null;
vi.mock('./useWorkflowPolling', () => ({
  useWorkflowPolling: () => ({
    runConclusion: workflowConclusion,
    runUrl: null,
    error: null,
  }),
}));

// Deployment health mock
vi.mock('./useDeploymentHealth', () => ({
  useDeploymentHealth: () => ({
    serviceEndpoint: null,
    isHealthy: false,
  }),
}));

import { useFastPathOrchestration } from './useFastPathOrchestration';

const selectedRepo = { owner: 'test', repo: 'repo', defaultBranch: 'main' };
const containerConfig = createContainerConfig();

const defaultProps = {
  clusterName: 'my-cluster',
  namespace: 'demo',
  appName: 'my-app',
  subscriptionId: 'sub-1',
  resourceGroup: 'rg-1',
  tenantId: 'tenant-1',
  selectedRepo,
  containerConfig,
  identityId: 'id-1',
  identityReady: true,
  acrLoginServer: 'myregistry.azurecr.io',
};

const dockerfileSelection = { path: 'Dockerfile', buildContext: '.' };

describe('useFastPathOrchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prPollingMerged = false;
    workflowConclusion = null;
    localStorage.clear();
  });

  it('should start in Configured state', () => {
    const { result } = renderHook(() => useFastPathOrchestration(defaultProps));
    expect(result.current.pipeline.state.deploymentState).toBe('Configured');
  });

  describe('handleDeploy', () => {
    it('blocks unverified resumed permissions before secrets or PR writes, then accepts fresh setup', async () => {
      const { result, rerender } = renderHook(
        ({ identityReady }) => useFastPathOrchestration({ ...defaultProps, identityReady }),
        { initialProps: { identityReady: false } }
      );
      await act(async () => result.current.handleDeploy({ selection: dockerfileSelection }));
      expect(mockCreatePipelineSecrets).not.toHaveBeenCalled();
      expect(mockCreateFastPathPR).not.toHaveBeenCalled();
      expect(result.current.pipeline.state.error).toContain('permissions must be verified');
      act(() => result.current.pipeline.retry());
      rerender({ identityReady: true });
      await act(async () => result.current.handleDeploy({ selection: dockerfileSelection }));
      expect(mockCreatePipelineSecrets).toHaveBeenCalledOnce();
      expect(mockCreateFastPathPR).toHaveBeenCalledOnce();
      expect(result.current.pipeline.state.deploymentState).toBe('FastPathPRAwaitingMerge');
    });

    it('rejects a stale deploy action after identity proof is invalidated', async () => {
      const { result, rerender } = renderHook(
        ({ identityReady }) => useFastPathOrchestration({ ...defaultProps, identityReady }),
        { initialProps: { identityReady: true } }
      );
      const previousDeploy = result.current.handleDeploy;
      rerender({ identityReady: false });
      await act(async () => previousDeploy({ selection: dockerfileSelection }));
      expect(mockCreatePipelineSecrets).not.toHaveBeenCalled();
      expect(mockCreateFastPathPR).not.toHaveBeenCalled();
      expect(result.current.pipeline.state.error).toContain('permissions must be verified');
    });
    it('rejects ID-only saved configuration before repository secrets or PR writes', async () => {
      const { result } = renderHook(() =>
        useFastPathOrchestration({
          ...defaultProps,
          acrLoginServer: undefined,
          acrResourceId:
            '/subscriptions/sub/resourceGroups/group/providers/Microsoft.ContainerRegistry/registries/myacr',
        })
      );
      await act(async () => {
        await result.current.handleDeploy({ selection: dockerfileSelection });
      });
      expect(mockCreatePipelineSecrets).not.toHaveBeenCalled();
      expect(mockCreateFastPathPR).not.toHaveBeenCalled();
      expect(result.current.pipeline.state.error).toContain('actual ACR login server');
    });

    it('preserves the selected registry scope and build arguments for secrets and PR generation', async () => {
      const registryConfig = {
        acrResourceId:
          '/subscriptions/registry-sub/resourceGroups/registry-rg/providers/Microsoft.ContainerRegistry/registries/myacr',
        acrLoginServer: 'myacr.azurecr.io',
        buildArguments: { MODE: 'production' },
      };
      const { result } = renderHook(() =>
        useFastPathOrchestration({ ...defaultProps, ...registryConfig })
      );

      await act(async () => {
        await result.current.handleDeploy({ selection: dockerfileSelection });
      });

      expect(mockCreatePipelineSecrets).toHaveBeenCalledWith(
        mockOctokit,
        expect.objectContaining({ ...registryConfig, resourceGroup: 'rg-1' })
      );
      expect(mockCreateFastPathPR).toHaveBeenCalledWith(
        mockOctokit,
        expect.objectContaining({
          pipelineConfig: expect.objectContaining(registryConfig),
        })
      );
      expect(result.current.pipeline.state.config).toEqual(expect.objectContaining(registryConfig));
    });

    it('should transition through generating → PR creating → PR awaiting merge', async () => {
      const { result } = renderHook(() => useFastPathOrchestration(defaultProps));

      await act(async () => {
        await result.current.handleDeploy({ selection: dockerfileSelection });
      });

      expect(mockCreatePipelineSecrets).toHaveBeenCalled();
      expect(mockCreateFastPathPR).toHaveBeenCalled();
      expect(result.current.pipeline.state.deploymentState).toBe('FastPathPRAwaitingMerge');
      expect(result.current.pipeline.state.fastPathPr.number).toBe(1);
    });

    it('should transition to Failed on secret creation error', async () => {
      mockCreatePipelineSecrets.mockRejectedValueOnce(new Error('secret error'));

      const { result } = renderHook(() => useFastPathOrchestration(defaultProps));

      await act(async () => {
        await result.current.handleDeploy({ selection: dockerfileSelection });
      });

      expect(result.current.pipeline.state.deploymentState).toBe('Failed');
      expect(result.current.pipeline.state.error).toBe('secret error');
    });

    it('should transition to Failed on PR creation error', async () => {
      mockCreateFastPathPR.mockRejectedValueOnce(new Error('PR failed'));

      const { result } = renderHook(() => useFastPathOrchestration(defaultProps));

      await act(async () => {
        await result.current.handleDeploy({ selection: dockerfileSelection });
      });

      expect(result.current.pipeline.state.deploymentState).toBe('Failed');
      expect(result.current.pipeline.state.error).toBe('PR failed');
    });

    it('should not deploy twice when already in flight', async () => {
      const { result } = renderHook(() => useFastPathOrchestration(defaultProps));

      // Start first deploy
      const promise1 = act(async () => {
        await result.current.handleDeploy({ selection: dockerfileSelection });
      });

      // Try second deploy while first is in flight — should be no-op
      const promise2 = act(async () => {
        await result.current.handleDeploy({ selection: dockerfileSelection });
      });

      await Promise.all([promise1, promise2]);

      expect(mockCreateFastPathPR).toHaveBeenCalledTimes(1);
    });
  });

  describe('state-driven transitions', () => {
    it('should transition to PipelineRunning when PR is merged', async () => {
      const { result, rerender } = renderHook(() => useFastPathOrchestration(defaultProps));

      // Get to FastPathPRAwaitingMerge
      await act(async () => {
        await result.current.handleDeploy({ selection: dockerfileSelection });
      });
      expect(result.current.pipeline.state.deploymentState).toBe('FastPathPRAwaitingMerge');

      // Simulate PR merge detected by polling
      prPollingMerged = true;
      rerender();

      // The effect should fire and transition to PipelineRunning
      expect(result.current.pipeline.state.deploymentState).toBe('PipelineRunning');
    });

    it('verifies merged setup before triggering async agent review and keeps deploy intact on failure', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mockGetRepoSetupStatus.mockResolvedValueOnce({
          isCurrent: false,
          hasSetupWorkflow: true,
          hasAgentConfig: true,
        });
        const { result, rerender } = renderHook(() => useFastPathOrchestration(defaultProps));
        await act(async () => {
          await result.current.handleDeploy({
            selection: dockerfileSelection,
            withAsyncAgent: true,
          });
        });
        prPollingMerged = true;
        rerender();
        workflowConclusion = 'success';
        await act(async () => {
          rerender();
        });
        expect(mockGetRepoSetupStatus).toHaveBeenCalledOnce();
        expect(mockTriggerAsyncAgentReview).not.toHaveBeenCalled();
        expect(result.current.pipeline.state.deploymentState).toBe('Deployed');
        expect(warnSpy).toHaveBeenCalledWith(
          'Skipping async agent review: repository setup is outdated or modified'
        );

        localStorage.clear();
        prPollingMerged = false;
        workflowConclusion = null;
        const verificationError = new Error('Verification unavailable');
        mockGetRepoSetupStatus.mockRejectedValueOnce(verificationError);
        const second = renderHook(() => useFastPathOrchestration(defaultProps));
        await act(async () => {
          await second.result.current.handleDeploy({
            selection: dockerfileSelection,
            withAsyncAgent: true,
          });
        });
        prPollingMerged = true;
        second.rerender();
        workflowConclusion = 'success';
        await act(async () => {
          second.rerender();
        });
        expect(mockGetRepoSetupStatus).toHaveBeenCalledTimes(2);
        expect(mockTriggerAsyncAgentReview).not.toHaveBeenCalled();
        expect(second.result.current.pipeline.state.deploymentState).toBe('Deployed');
        expect(warnSpy).toHaveBeenCalledWith(
          'Failed to trigger async agent review:',
          verificationError
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
