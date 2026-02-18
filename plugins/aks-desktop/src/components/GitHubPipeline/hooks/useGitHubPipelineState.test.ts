// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelineConfig, PipelineState } from '../types';
import { useGitHubPipelineState } from './useGitHubPipelineState';

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

/**
 * Helper: transitions the hook through valid states up to the target.
 * This ensures tests follow the state machine's transition table.
 */
function transitionTo(
  result: { current: ReturnType<typeof useGitHubPipelineState> },
  target: PipelineState['deploymentState']
) {
  // Configured is the initial state — nothing to do
  if (target === 'Configured') return;

  if (target === 'GitHubAuthorizationNeeded') {
    act(() => result.current.setAuthNeeded());
    return;
  }

  // Most paths go through Configured → CheckingRepo
  act(() => result.current.setCheckingRepo());
  if (target === 'CheckingRepo') return;

  if (target === 'AppInstallationNeeded') {
    act(() => result.current.setAppInstallNeeded());
    return;
  }

  // ReadyForSetup (files missing)
  act(() =>
    result.current.setRepoReadiness({
      hasSetupWorkflow: false,
      hasAgentConfig: false,
    })
  );
  if (target === 'ReadyForSetup') return;

  act(() => result.current.setCreatingSetupPR());
  if (target === 'SetupPRCreating') return;

  act(() =>
    result.current.setSetupPRCreated({
      url: 'https://github.com/test/repo/pull/1',
      number: 1,
      merged: false,
    })
  );
  if (target === 'SetupPRAwaitingMerge') return;

  act(() => result.current.setSetupPRMerged());
  if (target === 'AgentTaskCreating') return;

  act(() =>
    result.current.setAgentTriggered({
      url: 'https://github.com/test/repo/issues/5',
      number: 5,
    })
  );
  if (target === 'AgentRunning') return;

  act(() => result.current.setGeneratedPRCreated('https://github.com/test/repo/pull/6', 6));
  if (target === 'GeneratedPRAwaitingMerge') return;

  act(() => result.current.setGeneratedPRMerged());
  if (target === 'PipelineRunning') return;

  act(() => result.current.setDeployed('http://20.30.40.50'));
  if (target === 'Deployed') return;

  if (target === 'Failed') {
    act(() => result.current.setFailed('test error'));
    return;
  }
}

describe('useGitHubPipelineState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useGitHubPipelineState(null));

    expect(result.current.state.deploymentState).toBe('Configured');
    expect(result.current.state.config).toBeNull();
    expect(result.current.state.error).toBeNull();
  });

  it('should transition through setConfig', () => {
    const { result } = renderHook(() => useGitHubPipelineState(null));

    act(() => {
      result.current.setConfig(validConfig);
    });

    expect(result.current.state.deploymentState).toBe('Configured');
    expect(result.current.state.config).toEqual(validConfig);
    expect(result.current.state.createdAt).not.toBeNull();
  });

  it('should transition through setAuthNeeded', () => {
    const { result } = renderHook(() => useGitHubPipelineState(null));

    act(() => {
      result.current.setAuthNeeded();
    });

    expect(result.current.state.deploymentState).toBe('GitHubAuthorizationNeeded');
  });

  it('should transition from GitHubAuthorizationNeeded to Configured via setAuthCompleted', () => {
    const { result } = renderHook(() => useGitHubPipelineState(null));

    act(() => result.current.setAuthNeeded());
    expect(result.current.state.deploymentState).toBe('GitHubAuthorizationNeeded');

    act(() => result.current.setAuthCompleted());
    expect(result.current.state.deploymentState).toBe('Configured');
  });

  it('should transition through setAppInstallNeeded from CheckingRepo', () => {
    const { result } = renderHook(() => useGitHubPipelineState(null));

    transitionTo(result, 'CheckingRepo');

    act(() => {
      result.current.setAppInstallNeeded();
    });

    expect(result.current.state.deploymentState).toBe('AppInstallationNeeded');
  });

  it('should transition through setCheckingRepo', () => {
    const { result } = renderHook(() => useGitHubPipelineState(null));

    act(() => {
      result.current.setCheckingRepo();
    });

    expect(result.current.state.deploymentState).toBe('CheckingRepo');
  });

  describe('setRepoReadiness', () => {
    it('should transition to ReadyForSetup when files are missing', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      transitionTo(result, 'CheckingRepo');

      act(() => {
        result.current.setRepoReadiness({
          hasSetupWorkflow: false,
          hasAgentConfig: false,
        });
      });

      expect(result.current.state.deploymentState).toBe('ReadyForSetup');
    });

    it('should transition to AgentTaskCreating when repo is set up and config is complete', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      // Config must have identityId and appName for the skip to work
      act(() => {
        result.current.setConfig(validConfig);
      });
      // Configured → CheckingRepo
      act(() => {
        result.current.setCheckingRepo();
      });
      act(() => {
        result.current.setRepoReadiness({
          hasSetupWorkflow: true,
          hasAgentConfig: true,
        });
      });

      expect(result.current.state.deploymentState).toBe('AgentTaskCreating');
    });

    it('should transition to ReadyForSetup when repo is set up but config is incomplete', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      // Config with empty identityId/appName
      act(() => {
        result.current.setConfig({ ...validConfig, identityId: '', appName: '' });
      });
      act(() => {
        result.current.setCheckingRepo();
      });
      act(() => {
        result.current.setRepoReadiness({
          hasSetupWorkflow: true,
          hasAgentConfig: true,
        });
      });

      expect(result.current.state.deploymentState).toBe('ReadyForSetup');
    });
  });

  it('should transition through the setup PR flow', () => {
    const { result } = renderHook(() => useGitHubPipelineState(null));

    transitionTo(result, 'ReadyForSetup');

    act(() => {
      result.current.setCreatingSetupPR();
    });
    expect(result.current.state.deploymentState).toBe('SetupPRCreating');

    act(() => {
      result.current.setSetupPRCreated({
        url: 'https://github.com/test/repo/pull/1',
        number: 1,
        merged: false,
      });
    });
    expect(result.current.state.deploymentState).toBe('SetupPRAwaitingMerge');
    expect(result.current.state.setupPr.number).toBe(1);

    act(() => {
      result.current.setSetupPRMerged();
    });
    expect(result.current.state.deploymentState).toBe('AgentTaskCreating');
    expect(result.current.state.setupPr.merged).toBe(true);
  });

  it('should transition through the agent trigger flow', () => {
    const { result } = renderHook(() => useGitHubPipelineState(null));

    transitionTo(result, 'AgentTaskCreating');

    act(() => {
      result.current.setAgentTriggered({
        url: 'https://github.com/test/repo/issues/5',
        number: 5,
      });
    });
    expect(result.current.state.deploymentState).toBe('AgentRunning');
    expect(result.current.state.triggerIssue.number).toBe(5);

    act(() => {
      result.current.setGeneratedPRCreated('https://github.com/test/repo/pull/6', 6);
    });
    expect(result.current.state.deploymentState).toBe('GeneratedPRAwaitingMerge');
    expect(result.current.state.generatedPr.number).toBe(6);

    act(() => {
      result.current.setGeneratedPRMerged();
    });
    expect(result.current.state.deploymentState).toBe('PipelineRunning');
    expect(result.current.state.generatedPr.merged).toBe(true);
  });

  it('should transition to Deployed from PipelineRunning', () => {
    const { result } = renderHook(() => useGitHubPipelineState(null));

    transitionTo(result, 'PipelineRunning');

    act(() => {
      result.current.setDeployed('http://20.30.40.50');
    });
    expect(result.current.state.deploymentState).toBe('Deployed');
    expect(result.current.state.deployment.serviceEndpoint).toBe('http://20.30.40.50');
  });

  describe('setFailed and retry', () => {
    it('should transition to Failed and store error', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => {
        result.current.setFailed('Something broke');
      });
      expect(result.current.state.deploymentState).toBe('Failed');
      expect(result.current.state.error).toBe('Something broke');
    });

    it('should retry to Configured when no progress has been made', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => {
        result.current.setFailed('Error');
      });
      act(() => {
        result.current.retry();
      });
      expect(result.current.state.deploymentState).toBe('Configured');
      expect(result.current.state.error).toBeNull();
    });

    it('should retry to SetupPRAwaitingMerge when setup PR exists', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      transitionTo(result, 'SetupPRAwaitingMerge');

      act(() => {
        result.current.setFailed('Error');
      });
      act(() => {
        result.current.retry();
      });
      expect(result.current.state.deploymentState).toBe('SetupPRAwaitingMerge');
    });

    it('should retry to AgentTaskCreating when setup PR is merged', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      transitionTo(result, 'AgentTaskCreating');

      act(() => {
        result.current.setFailed('Error');
      });
      act(() => {
        result.current.retry();
      });
      expect(result.current.state.deploymentState).toBe('AgentTaskCreating');
    });

    it('should retry to ReadyForSetup when repo is already configured but config incomplete', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      // Simulate the skip-setup path: CheckingRepo → ReadyForSetup (with both files present)
      act(() => result.current.setCheckingRepo());
      act(() =>
        result.current.setRepoReadiness({
          hasSetupWorkflow: true,
          hasAgentConfig: true,
        })
      );
      // Without complete config, this lands on ReadyForSetup.
      // lastSuccessfulState tracks this, so retry returns there.
      act(() => {
        result.current.setFailed('Error');
      });
      act(() => {
        result.current.retry();
      });
      expect(result.current.state.deploymentState).toBe('ReadyForSetup');
    });

    it('should retry to AgentRunning when trigger issue exists', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      transitionTo(result, 'AgentRunning');

      act(() => {
        result.current.setFailed('Error');
      });
      act(() => {
        result.current.retry();
      });
      expect(result.current.state.deploymentState).toBe('AgentRunning');
    });

    it('should retry to GeneratedPRAwaitingMerge when generated PR exists', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      transitionTo(result, 'GeneratedPRAwaitingMerge');

      act(() => {
        result.current.setFailed('Error');
      });
      act(() => {
        result.current.retry();
      });
      expect(result.current.state.deploymentState).toBe('GeneratedPRAwaitingMerge');
    });

    it('should retry to Configured (not CheckingRepo) when failure occurs during CheckingRepo', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      // Configured → CheckingRepo (transient) → Failed
      act(() => result.current.setCheckingRepo());
      expect(result.current.state.deploymentState).toBe('CheckingRepo');

      act(() => result.current.setFailed('Network error'));
      expect(result.current.state.deploymentState).toBe('Failed');

      act(() => result.current.retry());
      // Should land on Configured, not CheckingRepo (dead-end)
      expect(result.current.state.deploymentState).toBe('Configured');
    });

    it('should retry to ReadyForSetup (not SetupPRCreating) when failure occurs during SetupPRCreating', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      transitionTo(result, 'ReadyForSetup');

      // ReadyForSetup → SetupPRCreating (transient) → Failed
      act(() => result.current.setCreatingSetupPR());
      expect(result.current.state.deploymentState).toBe('SetupPRCreating');

      act(() => result.current.setFailed('PR creation failed'));
      expect(result.current.state.deploymentState).toBe('Failed');

      act(() => result.current.retry());
      // Should land on ReadyForSetup, not SetupPRCreating (dead-end)
      expect(result.current.state.deploymentState).toBe('ReadyForSetup');
    });
  });

  describe('invalid transition guards', () => {
    it('should reject setDeployed from Configured state (no-op)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => {
        result.current.setDeployed('http://1.2.3.4');
      });

      expect(result.current.state.deploymentState).toBe('Configured');
      expect(result.current.state.deployment.serviceEndpoint).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        'Invalid pipeline transition: SET_DEPLOYED from Configured'
      );
      warnSpy.mockRestore();
    });

    it('should reject setSetupPRCreated from Configured state (no-op)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => {
        result.current.setSetupPRCreated({
          url: 'https://github.com/test/repo/pull/1',
          number: 1,
          merged: false,
        });
      });

      expect(result.current.state.deploymentState).toBe('Configured');
      expect(result.current.state.setupPr.number).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should reject setAgentTriggered from Configured state (no-op)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => {
        result.current.setAgentTriggered({ url: 'https://example.com/issues/1', number: 1 });
      });

      expect(result.current.state.deploymentState).toBe('Configured');
      expect(result.current.state.triggerIssue.number).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should reject retry from non-Failed state (no-op)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => {
        result.current.retry();
      });

      expect(result.current.state.deploymentState).toBe('Configured');
      expect(warnSpy).toHaveBeenCalledWith('Invalid pipeline transition: RETRY from Configured');
      warnSpy.mockRestore();
    });

    it('should reject setAuthNeeded from SetupPRAwaitingMerge (no-op)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() => useGitHubPipelineState(null));

      transitionTo(result, 'SetupPRAwaitingMerge');

      act(() => {
        result.current.setAuthNeeded();
      });

      // Should stay in SetupPRAwaitingMerge — auth re-check should not wipe progress
      expect(result.current.state.deploymentState).toBe('SetupPRAwaitingMerge');
      expect(warnSpy).toHaveBeenCalledWith(
        'Invalid pipeline transition: SET_AUTH_NEEDED from SetupPRAwaitingMerge'
      );
      warnSpy.mockRestore();
    });

    it('should allow setFailed from any state (universal action)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() => useGitHubPipelineState(null));

      // setFailed from Configured (initial state) should work
      act(() => {
        result.current.setFailed('Some error');
      });

      expect(result.current.state.deploymentState).toBe('Failed');
      expect(result.current.state.error).toBe('Some error');
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('localStorage persistence', () => {
    it('should persist state when repoKey is provided', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      const { result } = renderHook(() => useGitHubPipelineState('testuser/my-repo'));

      act(() => {
        result.current.setConfig(validConfig);
      });

      const calls = setItemSpy.mock.calls.filter(
        c => c[0] === 'aks-desktop:pipeline-state:testuser/my-repo'
      );
      expect(calls.length).toBeGreaterThan(0);
      setItemSpy.mockRestore();
    });

    it('should restore state from localStorage', () => {
      const persisted = {
        __schemaVersion: 1,
        deploymentState: 'SetupPRAwaitingMerge',
        config: validConfig,
        repoReadiness: null,
        setupPr: { url: 'https://example.com/pull/1', number: 1, merged: false },
        triggerIssue: { url: null, number: null },
        generatedPr: { url: null, number: null, merged: false },
        workflowRun: { url: null, id: null, status: null, conclusion: null },
        deployment: { podStatus: null, serviceEndpoint: null, healthSummary: null },
        lastSuccessfulState: 'SetupPRAwaitingMerge',
        error: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      localStorage.setItem(
        'aks-desktop:pipeline-state:testuser/my-repo',
        JSON.stringify(persisted)
      );

      const { result } = renderHook(() => useGitHubPipelineState('testuser/my-repo'));

      expect(result.current.state.deploymentState).toBe('SetupPRAwaitingMerge');
      expect(result.current.state.setupPr.number).toBe(1);
    });

    it('should discard persisted state with missing schema version', () => {
      const staleState = {
        deploymentState: 'SetupPRAwaitingMerge',
        config: validConfig,
        // No __schemaVersion — simulates pre-migration data
      };
      localStorage.setItem(
        'aks-desktop:pipeline-state:testuser/my-repo',
        JSON.stringify(staleState)
      );

      const { result } = renderHook(() => useGitHubPipelineState('testuser/my-repo'));

      // Should fall back to initial state, not the stale persisted state
      expect(result.current.state.deploymentState).toBe('Configured');
    });

    it('should discard persisted state with invalid deployment state', () => {
      const badState = {
        __schemaVersion: 1,
        deploymentState: 'NonExistentState',
        config: validConfig,
      };
      localStorage.setItem('aks-desktop:pipeline-state:testuser/my-repo', JSON.stringify(badState));

      const { result } = renderHook(() => useGitHubPipelineState('testuser/my-repo'));

      expect(result.current.state.deploymentState).toBe('Configured');
    });

    it('should not persist when repoKey is null', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => {
        result.current.setConfig(validConfig);
      });

      const pipelineCalls = setItemSpy.mock.calls.filter(c =>
        c[0].startsWith('aks-desktop:pipeline-state:')
      );
      expect(pipelineCalls).toHaveLength(0);
      setItemSpy.mockRestore();
    });
  });
});
