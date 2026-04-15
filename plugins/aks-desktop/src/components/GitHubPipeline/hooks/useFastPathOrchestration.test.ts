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
vi.mock('../utils/fastPathOrchestration', () => ({
  createFastPathPR: (...args: unknown[]) => mockCreateFastPathPR(...args),
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
    it('should transition through generating → PR creating → PR awaiting merge', async () => {
      const { result } = renderHook(() => useFastPathOrchestration(defaultProps));

      await act(async () => {
        await result.current.handleDeploy(dockerfileSelection);
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
        await result.current.handleDeploy(dockerfileSelection);
      });

      expect(result.current.pipeline.state.deploymentState).toBe('Failed');
      expect(result.current.pipeline.state.error).toBe('secret error');
    });

    it('should transition to Failed on PR creation error', async () => {
      mockCreateFastPathPR.mockRejectedValueOnce(new Error('PR failed'));

      const { result } = renderHook(() => useFastPathOrchestration(defaultProps));

      await act(async () => {
        await result.current.handleDeploy(dockerfileSelection);
      });

      expect(result.current.pipeline.state.deploymentState).toBe('Failed');
      expect(result.current.pipeline.state.error).toBe('PR failed');
    });

    it('should not deploy twice when already in flight', async () => {
      const { result } = renderHook(() => useFastPathOrchestration(defaultProps));

      // Start first deploy
      const promise1 = act(async () => {
        await result.current.handleDeploy(dockerfileSelection);
      });

      // Try second deploy while first is in flight — should be no-op
      const promise2 = act(async () => {
        await result.current.handleDeploy(dockerfileSelection);
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
        await result.current.handleDeploy(dockerfileSelection);
      });
      expect(result.current.pipeline.state.deploymentState).toBe('FastPathPRAwaitingMerge');

      // Simulate PR merge detected by polling
      prPollingMerged = true;
      rerender();

      // The effect should fire and transition to PipelineRunning
      expect(result.current.pipeline.state.deploymentState).toBe('PipelineRunning');
    });
  });
});
