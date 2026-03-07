// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineConfig, PipelineState } from '../types';
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
  if (target === 'Configured') return;

  if (target === 'GitHubAuthorizationNeeded') {
    act(() => result.current.setAuthNeeded());
    return;
  }

  // Ensure config is set so identity check passes (avoids WorkloadIdentitySetup detour)
  if (!result.current.state.config) {
    act(() => result.current.setConfig(validConfig));
  }
  act(() => result.current.setCheckingRepo());
  if (target === 'CheckingRepo') return;

  if (target === 'AppInstallationNeeded') {
    act(() => result.current.setAppInstallNeeded());
    return;
  }

  if (target === 'WorkloadIdentitySetup') {
    // Need config without identity to trigger WorkloadIdentitySetup
    act(() => result.current.setAppInstallNeeded());
    act(() => result.current.updateConfig({ identityId: '' }));
    act(() => result.current.setCheckingRepo());
    act(() =>
      result.current.setRepoReadiness({
        hasSetupWorkflow: false,
        hasAgentConfig: false,
        hasDeployWorkflow: false,
      })
    );
    return;
  }

  // ReadyForSetup (files missing, config has identity)
  act(() =>
    result.current.setRepoReadiness({
      hasSetupWorkflow: false,
      hasAgentConfig: false,
      hasDeployWorkflow: false,
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

  if (target === 'PipelineConfigured') {
    act(() => result.current.setPipelineConfigured());
    return;
  }

  act(() => result.current.setGeneratedPRMerged());
  if (target === 'PipelineRunning') return;

  act(() => result.current.setDeployed('http://20.30.40.50'));
  if (target === 'Deployed') return;

  if (target === 'Failed') {
    act(() => result.current.setFailed('test error'));
    return;
  }

  if (result.current.state.deploymentState !== target) {
    throw new Error(
      `transitionTo(${target}) failed — ended up at ${result.current.state.deploymentState}`
    );
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

  it('should partially update config', () => {
    const { result } = renderHook(() => useGitHubPipelineState(null));
    act(() => result.current.setConfig(validConfig));
    act(() => result.current.updateConfig({ appName: 'new-name' }));
    expect(result.current.state.config?.appName).toBe('new-name');
    expect(result.current.state.config?.clusterName).toBe('my-cluster');
  });

  it('should no-op updateConfig when config is null', () => {
    const { result } = renderHook(() => useGitHubPipelineState(null));
    act(() => result.current.updateConfig({ appName: 'new-name' }));
    expect(result.current.state.config).toBeNull();
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
    it('should transition to WorkloadIdentitySetup when files are missing and no identity', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      // Set config without identity
      act(() => result.current.setConfig({ ...validConfig, identityId: '' }));
      act(() => result.current.setCheckingRepo());

      act(() => {
        result.current.setRepoReadiness({
          hasSetupWorkflow: false,
          hasAgentConfig: false,
          hasDeployWorkflow: false,
        });
      });

      expect(result.current.state.deploymentState).toBe('WorkloadIdentitySetup');
    });

    it('should transition to ReadyForSetup when files are missing and identity exists', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => result.current.setConfig(validConfig));
      act(() => result.current.setCheckingRepo());

      act(() => {
        result.current.setRepoReadiness({
          hasSetupWorkflow: false,
          hasAgentConfig: false,
          hasDeployWorkflow: false,
        });
      });

      expect(result.current.state.deploymentState).toBe('ReadyForSetup');
    });

    it('should transition to AgentTaskCreating when repo is set up and config is complete', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => {
        result.current.setConfig(validConfig);
      });
      act(() => {
        result.current.setCheckingRepo();
      });
      act(() => {
        result.current.setRepoReadiness({
          hasSetupWorkflow: true,
          hasAgentConfig: true,
          hasDeployWorkflow: false,
        });
      });

      expect(result.current.state.deploymentState).toBe('AgentTaskCreating');
    });

    it('should transition to WorkloadIdentitySetup when repo is set up but identity is missing', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));
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
          hasDeployWorkflow: false,
        });
      });

      expect(result.current.state.deploymentState).toBe('WorkloadIdentitySetup');
    });

    it('should transition to ReadyForSetup when repo is set up but appName is missing', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => {
        result.current.setConfig({ ...validConfig, appName: '' });
      });
      act(() => {
        result.current.setCheckingRepo();
      });
      act(() => {
        result.current.setRepoReadiness({
          hasSetupWorkflow: true,
          hasAgentConfig: true,
          hasDeployWorkflow: false,
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

  it('should transition from GeneratedPRAwaitingMerge to PipelineConfigured', () => {
    const { result } = renderHook(() => useGitHubPipelineState(null));

    transitionTo(result, 'GeneratedPRAwaitingMerge');

    act(() => result.current.setPipelineConfigured());
    expect(result.current.state.deploymentState).toBe('PipelineConfigured');
    expect(result.current.state.generatedPr.merged).toBe(true);
  });

  it('should transition to Deployed from PipelineRunning', () => {
    const { result } = renderHook(() => useGitHubPipelineState(null));

    transitionTo(result, 'PipelineRunning');

    act(() => {
      result.current.setDeployed('http://20.30.40.50');
    });
    expect(result.current.state.deploymentState).toBe('Deployed');
    expect(result.current.state.serviceEndpoint).toBe('http://20.30.40.50');
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

    it('should retry to WorkloadIdentitySetup when failed during identity setup', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      // Config without identity to trigger WorkloadIdentitySetup
      act(() => result.current.setConfig({ ...validConfig, identityId: '' }));
      act(() => result.current.setCheckingRepo());
      act(() =>
        result.current.setRepoReadiness({
          hasSetupWorkflow: true,
          hasAgentConfig: true,
          hasDeployWorkflow: false,
        })
      );
      // Without identity, this lands on WorkloadIdentitySetup (transient).
      // Retry maps transient states to their parent (Configured).
      expect(result.current.state.deploymentState).toBe('WorkloadIdentitySetup');
      act(() => {
        result.current.setFailed('Error');
      });
      act(() => {
        result.current.retry();
      });
      expect(result.current.state.deploymentState).toBe('Configured');
    });

    it('should retry to ReadyForSetup when repo is already configured but appName missing', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      // Config with identity but no appName
      act(() => result.current.setConfig({ ...validConfig, appName: '' }));
      act(() => result.current.setCheckingRepo());
      act(() =>
        result.current.setRepoReadiness({
          hasSetupWorkflow: true,
          hasAgentConfig: true,
          hasDeployWorkflow: false,
        })
      );
      // With identity but no appName, this lands on ReadyForSetup.
      expect(result.current.state.deploymentState).toBe('ReadyForSetup');
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
      expect(result.current.state.deploymentState).toBe('ReadyForSetup');
    });
  });

  describe('invalid transition guards', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('should reject setDeployed from Configured state (no-op)', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => {
        result.current.setDeployed('http://1.2.3.4');
      });

      expect(result.current.state.deploymentState).toBe('Configured');
      expect(result.current.state.serviceEndpoint).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        'Invalid pipeline transition: SET_DEPLOYED from Configured'
      );
    });

    it('should reject setSetupPRCreated from Configured state (no-op)', () => {
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
    });

    it('should reject setAgentTriggered from Configured state (no-op)', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => {
        result.current.setAgentTriggered({ url: 'https://example.com/issues/1', number: 1 });
      });

      expect(result.current.state.deploymentState).toBe('Configured');
      expect(result.current.state.triggerIssue.number).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should reject retry from non-Failed state (no-op)', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => {
        result.current.retry();
      });

      expect(result.current.state.deploymentState).toBe('Configured');
      expect(warnSpy).toHaveBeenCalledWith('Invalid pipeline transition: RETRY from Configured');
    });

    it('should allow setAuthNeeded from any state and return to that state after auth', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      transitionTo(result, 'SetupPRAwaitingMerge');

      act(() => {
        result.current.setAuthNeeded();
      });

      expect(result.current.state.deploymentState).toBe('GitHubAuthorizationNeeded');
      expect(result.current.state.lastSuccessfulState).toBe('SetupPRAwaitingMerge');

      act(() => {
        result.current.setAuthCompleted();
      });

      expect(result.current.state.deploymentState).toBe('SetupPRAwaitingMerge');
    });

    it('should return to AgentRunning after re-auth even with stale lastSuccessfulState', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      transitionTo(result, 'AgentRunning');

      act(() => {
        result.current.setAuthNeeded();
      });

      expect(result.current.state.deploymentState).toBe('GitHubAuthorizationNeeded');
      expect(result.current.state.lastSuccessfulState).toBe('AgentRunning');

      act(() => {
        result.current.setAuthCompleted();
      });

      expect(result.current.state.deploymentState).toBe('AgentRunning');
    });

    it('should allow setFailed from any state (universal action)', () => {
      const { result } = renderHook(() => useGitHubPipelineState(null));

      act(() => {
        result.current.setFailed('Some error');
      });

      expect(result.current.state.deploymentState).toBe('Failed');
      expect(result.current.state.error).toBe('Some error');
      expect(warnSpy).not.toHaveBeenCalled();

      act(() => result.current.retry());
      transitionTo(result, 'AgentRunning');
      expect(result.current.state.deploymentState).toBe('AgentRunning');

      act(() => {
        result.current.setFailed('Agent error');
      });

      expect(result.current.state.deploymentState).toBe('Failed');
      expect(result.current.state.error).toBe('Agent error');

      act(() => result.current.retry());
      expect(result.current.state.deploymentState).toBe('AgentRunning');
      act(() => result.current.setGeneratedPRCreated('https://github.com/test/repo/pull/6', 6));
      act(() => result.current.setGeneratedPRMerged());
      expect(result.current.state.deploymentState).toBe('PipelineRunning');

      act(() => {
        result.current.setFailed('Pipeline error');
      });

      expect(result.current.state.deploymentState).toBe('Failed');
      expect(result.current.state.error).toBe('Pipeline error');
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('localStorage persistence', () => {
    it('should persist state when repoKey is provided', () => {
      vi.useFakeTimers();
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      const { result } = renderHook(() => useGitHubPipelineState('testuser/my-repo'));

      act(() => {
        result.current.setConfig(validConfig);
      });

      // Persistence is debounced with a 1000ms timeout
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      const calls = setItemSpy.mock.calls.filter(
        c => c[0] === 'aks-desktop:pipeline-state:testuser/my-repo'
      );
      expect(calls.length).toBeGreaterThan(0);
      setItemSpy.mockRestore();
      vi.useRealTimers();
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
        serviceEndpoint: null,
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

    it('handles malformed JSON in localStorage gracefully', () => {
      localStorage.setItem('aks-desktop:pipeline-state:test-owner/test-repo', 'not valid json{{{');
      const { result } = renderHook(() => useGitHubPipelineState('test-owner/test-repo'));
      expect(result.current.state.deploymentState).toBe('Configured');
    });

    it('handles persisted state with missing fields', () => {
      localStorage.setItem(
        'aks-desktop:pipeline-state:test-owner/test-repo',
        JSON.stringify({ __schemaVersion: 1, deploymentState: 'ReadyForSetup' })
      );
      const { result } = renderHook(() => useGitHubPipelineState('test-owner/test-repo'));
      // Should either restore the state or fall back to initial — verify it doesn't crash
      expect(result.current.state.deploymentState).toBeDefined();
    });

    it('discards state with unknown schema version', () => {
      localStorage.setItem(
        'aks-desktop:pipeline-state:test-owner/test-repo',
        JSON.stringify({ __schemaVersion: 999, deploymentState: 'Deployed' })
      );
      const { result } = renderHook(() => useGitHubPipelineState('test-owner/test-repo'));
      expect(result.current.state.deploymentState).toBe('Configured');
    });
  });
});
