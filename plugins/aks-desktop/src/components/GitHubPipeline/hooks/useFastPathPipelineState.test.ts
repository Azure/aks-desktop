// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineConfig } from '../types';
import {
  FAST_PATH_DEPLOYMENT_STATES,
  type FastPathState,
  useFastPathPipelineState,
} from './useFastPathPipelineState';

const validConfig: PipelineConfig = {
  tenantId: 'tenant-123',
  identityId: 'identity-456',
  subscriptionId: 'sub-789',
  clusterName: 'my-cluster',
  resourceGroup: 'my-rg',
  namespace: 'production',
  appName: 'my-app',
  serviceType: 'LoadBalancer',
  repo: { owner: 'testuser', repo: 'my-repo', defaultBranch: 'main' },
};

const repoKey = 'testuser/my-repo';

/**
 * Helper: transitions the hook through valid states up to the target.
 */
function transitionTo(
  result: { current: ReturnType<typeof useFastPathPipelineState> },
  target: FastPathState['deploymentState']
) {
  if (target === 'Configured') return;

  act(() => result.current.setDockerfileDetected(['Dockerfile']));
  if (target === 'DockerfileDetected') return;

  act(() => result.current.setGenerating());
  if (target === 'FastPathGenerating') return;

  act(() => result.current.setPRCreating());
  if (target === 'FastPathPRCreating') return;

  act(() =>
    result.current.setPRCreated({
      url: 'https://github.com/test/repo/pull/1',
      number: 1,
      merged: false,
    })
  );
  if (target === 'FastPathPRAwaitingMerge') return;

  act(() => result.current.setPRMerged());
  if (target === 'PipelineRunning') return;

  if (target === 'Deployed') {
    act(() => result.current.setDeployed());
    return;
  }

  if (target === 'AsyncAgentTriggered') {
    act(() => result.current.setDeployed());
    act(() => result.current.setAsyncAgentTriggered('https://github.com/test/repo/issues/10'));
    return;
  }

  if (target === 'Failed') {
    act(() => result.current.setFailed('something broke'));
    return;
  }
}

describe('useFastPathPipelineState', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should start in Configured state', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));
      expect(result.current.state.deploymentState).toBe('Configured');
      expect(result.current.state.config).toBeNull();
      expect(result.current.state.fastPathPr).toEqual({
        url: null,
        number: null,
        merged: false,
      });
    });

    it('should export all deployment states', () => {
      expect(FAST_PATH_DEPLOYMENT_STATES).toContain('Configured');
      expect(FAST_PATH_DEPLOYMENT_STATES).toContain('DockerfileDetected');
      expect(FAST_PATH_DEPLOYMENT_STATES).toContain('FastPathGenerating');
      expect(FAST_PATH_DEPLOYMENT_STATES).toContain('FastPathPRCreating');
      expect(FAST_PATH_DEPLOYMENT_STATES).toContain('FastPathPRAwaitingMerge');
      expect(FAST_PATH_DEPLOYMENT_STATES).toContain('PipelineRunning');
      expect(FAST_PATH_DEPLOYMENT_STATES).toContain('Deployed');
      expect(FAST_PATH_DEPLOYMENT_STATES).toContain('AsyncAgentTriggered');
      expect(FAST_PATH_DEPLOYMENT_STATES).toContain('Failed');
    });
  });

  describe('valid transitions', () => {
    it('should transition through the happy path', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));

      transitionTo(result, 'DockerfileDetected');
      expect(result.current.state.deploymentState).toBe('DockerfileDetected');
      expect(result.current.state.dockerfilePaths).toEqual(['Dockerfile']);

      transitionTo(result, 'FastPathGenerating');
      expect(result.current.state.deploymentState).toBe('FastPathGenerating');

      transitionTo(result, 'FastPathPRCreating');
      expect(result.current.state.deploymentState).toBe('FastPathPRCreating');

      transitionTo(result, 'FastPathPRAwaitingMerge');
      expect(result.current.state.deploymentState).toBe('FastPathPRAwaitingMerge');
      expect(result.current.state.fastPathPr.url).toBe('https://github.com/test/repo/pull/1');

      transitionTo(result, 'PipelineRunning');
      expect(result.current.state.deploymentState).toBe('PipelineRunning');
      expect(result.current.state.fastPathPr.merged).toBe(true);

      transitionTo(result, 'Deployed');
      expect(result.current.state.deploymentState).toBe('Deployed');
    });

    it('should transition from Deployed to AsyncAgentTriggered', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));
      transitionTo(result, 'Deployed');

      act(() => result.current.setAsyncAgentTriggered('https://github.com/test/repo/issues/10'));
      expect(result.current.state.deploymentState).toBe('AsyncAgentTriggered');
      expect(result.current.state.asyncAgentIssueUrl).toBe(
        'https://github.com/test/repo/issues/10'
      );
    });

    it('should allow SET_FAILED from any state', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));
      transitionTo(result, 'FastPathGenerating');

      act(() => result.current.setFailed('generation failed'));
      expect(result.current.state.deploymentState).toBe('Failed');
      expect(result.current.state.error).toBe('generation failed');
    });

    it('should set serviceEndpoint on deploy', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));
      transitionTo(result, 'PipelineRunning');

      act(() => result.current.setDeployed('http://10.0.0.1'));
      expect(result.current.state.serviceEndpoint).toBe('http://10.0.0.1');
    });
  });

  describe('invalid transitions', () => {
    it('should reject SET_GENERATING from Configured', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));

      act(() => result.current.setGenerating());
      expect(result.current.state.deploymentState).toBe('Configured');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid fast-path transition'));
      warnSpy.mockRestore();
    });

    it('should reject SET_PR_MERGED from Configured', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));

      act(() => result.current.setPRMerged());
      expect(result.current.state.deploymentState).toBe('Configured');
      warnSpy.mockRestore();
    });
  });

  describe('RETRY', () => {
    it('should return to lastSuccessfulState on retry', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));
      transitionTo(result, 'FastPathPRAwaitingMerge');

      act(() => result.current.setFailed('merge failed'));
      expect(result.current.state.deploymentState).toBe('Failed');

      act(() => result.current.retry());
      expect(result.current.state.deploymentState).toBe('FastPathPRAwaitingMerge');
      expect(result.current.state.error).toBeNull();
    });

    it('should return to Configured when no lastSuccessfulState', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));

      act(() => result.current.setFailed('early failure'));
      act(() => result.current.retry());
      expect(result.current.state.deploymentState).toBe('Configured');
    });

    it('should not record transient states as lastSuccessfulState', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));
      transitionTo(result, 'DockerfileDetected');
      // FastPathGenerating is transient
      act(() => result.current.setGenerating());
      act(() => result.current.setFailed('gen failed'));
      act(() => result.current.retry());
      // Should go back to DockerfileDetected, not FastPathGenerating
      expect(result.current.state.deploymentState).toBe('DockerfileDetected');
    });
  });

  describe('config management', () => {
    it('should set config', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));

      act(() => result.current.setConfig(validConfig));
      expect(result.current.state.config).toEqual(validConfig);
      expect(result.current.state.deploymentState).toBe('Configured');
    });

    it('should update config partially', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));

      act(() => result.current.setConfig(validConfig));
      act(() => result.current.updateConfig({ appName: 'new-app' }));
      expect(result.current.state.config?.appName).toBe('new-app');
      expect(result.current.state.config?.clusterName).toBe('my-cluster');
    });
  });

  describe('persistence', () => {
    it('should persist state after debounce', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));
      transitionTo(result, 'DockerfileDetected');

      act(() => vi.advanceTimersByTime(1000));
      const stored = localStorage.getItem('aks-desktop:fast-path-state:testuser/my-repo');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.deploymentState).toBe('DockerfileDetected');
      expect(parsed.__schemaVersion).toBe(1);
    });

    it('should load persisted state on mount', () => {
      // Persist some state
      const { result: first } = renderHook(() => useFastPathPipelineState(repoKey));
      transitionTo(first, 'FastPathPRAwaitingMerge');
      act(() => vi.advanceTimersByTime(1000));

      // Mount a new hook — should load persisted state
      const { result: second } = renderHook(() => useFastPathPipelineState(repoKey));
      expect(second.current.state.deploymentState).toBe('FastPathPRAwaitingMerge');
    });

    it('should clear terminal states from storage', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));
      transitionTo(result, 'Deployed');
      act(() => vi.advanceTimersByTime(1000));

      const stored = localStorage.getItem('aks-desktop:fast-path-state:testuser/my-repo');
      expect(stored).toBeNull();
    });

    it('should ignore malformed persisted data', () => {
      localStorage.setItem('aks-desktop:fast-path-state:testuser/my-repo', 'not-json');
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));
      expect(result.current.state.deploymentState).toBe('Configured');
    });

    it('should ignore persisted data with wrong schema version', () => {
      localStorage.setItem(
        'aks-desktop:fast-path-state:testuser/my-repo',
        JSON.stringify({ __schemaVersion: 999, deploymentState: 'DockerfileDetected' })
      );
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));
      expect(result.current.state.deploymentState).toBe('Configured');
    });
  });

  describe('LOAD_STATE', () => {
    it('should replace state entirely on LOAD_STATE', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));

      const loaded: FastPathState = {
        deploymentState: 'FastPathPRAwaitingMerge',
        config: validConfig,
        dockerfilePaths: ['Dockerfile'],
        fastPathPr: {
          url: 'https://github.com/test/repo/pull/1',
          number: 1,
          merged: false,
        },
        asyncAgentIssueUrl: null,
        serviceEndpoint: null,
        lastSuccessfulState: 'FastPathPRAwaitingMerge',
        error: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      act(() => result.current.loadState(loaded));
      expect(result.current.state).toEqual(loaded);
    });
  });
});
