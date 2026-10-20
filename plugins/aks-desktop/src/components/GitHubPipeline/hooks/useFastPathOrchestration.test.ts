// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContainerConfig } from '../__fixtures__/pipelineConfig';

// --- Mock sub-hooks and utilities ---

const mockOctokit = { request: vi.fn() } as never;
let currentOctokit = mockOctokit;
let sessionVersion = 1;
let sessionActive = true;
let repoAccess: 'granted' | 'checking' | 'denied' = 'granted';

vi.mock('../../../utils/github/github-session', () => ({
  isGitHubSessionCurrent: (version: number) => sessionActive && version === sessionVersion,
}));
vi.mock('./useGitHubRepoAccess', () => ({
  useGitHubRepoAccess: () => ({ status: repoAccess, error: null }),
}));

vi.mock('../GitHubAuthContext', () => ({
  useGitHubAuthContext: () => ({
    octokit: currentOctokit,
    authState: { isAuthenticated: sessionActive, isRestoring: false, sessionVersion },
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
    currentOctokit = mockOctokit;
    sessionVersion = 1;
    sessionActive = true;
    repoAccess = 'granted';
    localStorage.clear();
  });

  it('retries a failed dispatch explicitly but does not replay it again on reconnect', async () => {
    mockDispatchWorkflow.mockRejectedValueOnce(new Error('temporary dispatch failure'));
    const { result, rerender } = renderHook(() => useFastPathOrchestration(defaultProps));
    await act(async () => {
      await result.current.handleDeploy({ selection: dockerfileSelection });
    });
    prPollingMerged = true;
    await act(async () => {
      rerender();
    });
    expect(result.current.pipeline.state.deploymentState).toBe('Failed');
    act(() => result.current.pipeline.retry());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockDispatchWorkflow).toHaveBeenCalledTimes(2);
    sessionVersion = 2;
    currentOctokit = { request: vi.fn() } as never;
    await act(async () => {
      rerender();
    });
    expect(mockDispatchWorkflow).toHaveBeenCalledTimes(2);
  });

  it('should start in Configured state', () => {
    const { result } = renderHook(() => useFastPathOrchestration(defaultProps));
    expect(result.current.pipeline.state.deploymentState).toBe('Configured');
  });

  describe('handleDeploy', () => {
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
  });

  it('does not mutate progress or dispatch while selected-repository access is unchecked', async () => {
    repoAccess = 'checking';
    const { result } = renderHook(() => useFastPathOrchestration(defaultProps));
    const before = JSON.stringify(localStorage);
    await act(async () => {
      await result.current.handleDeploy({ selection: dockerfileSelection });
    });
    expect(mockCreatePipelineSecrets).not.toHaveBeenCalled();
    expect(result.current.pipeline.state.deploymentState).toBe('Configured');
    expect(JSON.stringify(localStorage)).toBe(before);
  });

  it('rejects an old session completion and does not let its finally unlock a newer deploy', async () => {
    let finishA!: () => void;
    let finishB!: () => void;
    const a = new Promise<void>(resolve => {
      finishA = resolve;
    });
    const b = new Promise<void>(resolve => {
      finishB = resolve;
    });
    mockCreatePipelineSecrets.mockReturnValueOnce(a).mockReturnValueOnce(b);
    const { result, rerender } = renderHook(() => useFastPathOrchestration(defaultProps));
    let operationA!: Promise<void>;
    let operationB!: Promise<void>;
    act(() => {
      operationA = result.current.handleDeploy({ selection: dockerfileSelection });
    });
    sessionVersion = 2;
    currentOctokit = { request: vi.fn() } as never;
    rerender();
    act(() => {
      operationB = result.current.handleDeploy({ selection: dockerfileSelection });
    });
    try {
      expect(mockCreatePipelineSecrets).toHaveBeenCalledTimes(2);
      await act(async () => {
        finishA();
        await operationA;
      });
      expect(mockCreateFastPathPR).not.toHaveBeenCalled();
      await act(async () => {
        await result.current.handleDeploy({ selection: dockerfileSelection });
      });
      expect(mockCreatePipelineSecrets).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => {
        finishA();
        finishB();
        await operationA;
        await operationB;
      });
    }
    expect(mockCreateFastPathPR).toHaveBeenCalledTimes(1);
    expect(result.current.pipeline.state.deploymentState).toBe('FastPathPRAwaitingMerge');
  });

  it('does not automatically dispatch a second deployment after reconnecting during PipelineRunning', async () => {
    const { result, rerender } = renderHook(() => useFastPathOrchestration(defaultProps));
    await act(async () => {
      await result.current.handleDeploy({ selection: dockerfileSelection });
    });
    prPollingMerged = true;
    await act(async () => {
      rerender();
    });
    expect(mockDispatchWorkflow).toHaveBeenCalledTimes(1);
    const before = JSON.stringify(localStorage);
    sessionVersion = 2;
    currentOctokit = { request: vi.fn() } as never;
    await act(async () => {
      rerender();
    });
    expect(mockDispatchWorkflow).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(localStorage)).toBe(before);
  });
});
