// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import type { RepoReadiness } from '../../../types/github';
import { SCHEMA_VERSION, STORAGE_KEY_PREFIX } from '../constants';
import {
  DEPLOYMENT_STATES,
  type IssueTracking,
  type PipelineConfig,
  type PipelineDeploymentState,
  type PipelineState,
  type PRTracking,
} from '../types';
import { safeRecord } from '../utils/safeRecord';

/**
 * Transient (in-flight) states that are dead-ends for RETRY because the
 * orchestration effect only transitions *into* them, not *from* them.
 */
const TRANSIENT_STATES: ReadonlySet<PipelineDeploymentState> = new Set([
  'CheckingRepo',
  'WorkloadIdentitySetup',
  'SetupPRCreating',
]);

/**
 * States that should NOT be recorded as lastSuccessfulState.
 * Includes transient states that would cause RETRY to land on a dead-end,
 * plus Failed and GitHubAuthorizationNeeded which preserve the existing
 * lastSuccessfulState for recovery.
 */
const NON_RESUMABLE_STATES: ReadonlySet<PipelineDeploymentState> = new Set([
  ...TRANSIENT_STATES,
  'Failed',
  'GitHubAuthorizationNeeded',
]);

const VALID_DEPLOYMENT_STATES: ReadonlySet<string> = new Set<string>(DEPLOYMENT_STATES);

/** Terminal states that don't need persistence — nothing to resume. */
const TERMINAL_STATES: ReadonlySet<PipelineDeploymentState> = new Set([
  'PipelineConfigured',
  'Deployed',
]);

const INITIAL_STATE: PipelineState = {
  deploymentState: 'Configured',
  config: null,
  repoReadiness: null,
  setupPr: { url: null, number: null, merged: false },
  triggerIssue: { url: null, number: null },
  generatedPr: { url: null, number: null, merged: false },
  serviceEndpoint: null,
  lastSuccessfulState: null,
  error: null,
  createdAt: null,
  updatedAt: null,
};

const loadPersistedState = (repoKey: string): PipelineState | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PREFIX + repoKey);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (
      !('__schemaVersion' in parsed) ||
      (parsed as Record<string, unknown>).__schemaVersion !== SCHEMA_VERSION
    ) {
      return null;
    }
    if (
      !('deploymentState' in parsed) ||
      typeof (parsed as Record<string, unknown>).deploymentState !== 'string'
    ) {
      return null;
    }
    const deploymentState = (parsed as Record<string, unknown>).deploymentState as string;
    if (!VALID_DEPLOYMENT_STATES.has(deploymentState)) return null;
    if (TERMINAL_STATES.has(deploymentState as PipelineDeploymentState)) {
      localStorage.removeItem(STORAGE_KEY_PREFIX + repoKey);
      return null;
    }
    const data = parsed as Record<string, unknown>;
    return {
      ...INITIAL_STATE,
      ...data,
      deploymentState: deploymentState as PipelineDeploymentState,
      setupPr: { ...INITIAL_STATE.setupPr, ...safeRecord(data.setupPr) },
      triggerIssue: { ...INITIAL_STATE.triggerIssue, ...safeRecord(data.triggerIssue) },
      generatedPr: { ...INITIAL_STATE.generatedPr, ...safeRecord(data.generatedPr) },
      // Migrate legacy persisted state that used nested deployment object
      serviceEndpoint:
        (data.serviceEndpoint as string) ??
        ((data.deployment as Record<string, unknown> | undefined)?.serviceEndpoint as string) ??
        null,
    } as PipelineState;
  } catch {
    return null;
  }
};

const persistState = (repoKey: string, state: PipelineState): void => {
  try {
    if (TERMINAL_STATES.has(state.deploymentState)) {
      localStorage.removeItem(STORAGE_KEY_PREFIX + repoKey);
      return;
    }
    localStorage.setItem(
      STORAGE_KEY_PREFIX + repoKey,
      JSON.stringify({ __schemaVersion: SCHEMA_VERSION, ...state })
    );
  } catch (err) {
    console.warn('Failed to persist pipeline state:', err);
  }
};

const now = () => new Date().toISOString();

type PipelineAction =
  | { type: 'SET_CONFIG'; config: PipelineConfig }
  | { type: 'UPDATE_CONFIG'; partial: Partial<PipelineConfig> }
  | { type: 'SET_AUTH_NEEDED' }
  | { type: 'SET_AUTH_COMPLETED' }
  | { type: 'SET_APP_INSTALL_NEEDED' }
  | { type: 'SET_CHECKING_REPO' }
  | { type: 'SET_REPO_READINESS'; readiness: RepoReadiness }
  | { type: 'SET_IDENTITY_SETUP' }
  | { type: 'SET_IDENTITY_READY' }
  | { type: 'SET_CREATING_SETUP_PR' }
  | { type: 'SET_SETUP_PR_CREATED'; pr: PRTracking }
  | { type: 'SET_SETUP_PR_MERGED' }
  | { type: 'SET_AGENT_TRIGGERED'; issue: IssueTracking }
  | { type: 'SET_GENERATED_PR_CREATED'; prUrl: string; prNumber: number }
  | { type: 'SET_GENERATED_PR_MERGED' }
  | { type: 'SET_PIPELINE_CONFIGURED' }
  | { type: 'SET_DEPLOYED'; serviceEndpoint?: string }
  | { type: 'SET_FAILED'; error: string }
  | { type: 'RETRY' }
  | { type: 'LOAD_STATE'; state: PipelineState };

const VALID_TRANSITIONS: Record<
  PipelineAction['type'],
  ReadonlySet<PipelineDeploymentState> | null
> = {
  SET_CONFIG: new Set(['Configured', 'GitHubAuthorizationNeeded']),
  UPDATE_CONFIG: null,
  SET_AUTH_NEEDED: null, // Auth can expire at any point; lastSuccessfulState is preserved for return
  SET_AUTH_COMPLETED: new Set(['GitHubAuthorizationNeeded']),
  SET_APP_INSTALL_NEEDED: new Set(['CheckingRepo', 'AppInstallationNeeded']),
  SET_CHECKING_REPO: new Set(['Configured', 'AppInstallationNeeded']),
  SET_REPO_READINESS: new Set(['CheckingRepo', 'AppInstallationNeeded']),
  SET_IDENTITY_SETUP: new Set(['CheckingRepo', 'ReadyForSetup']),
  SET_IDENTITY_READY: new Set(['WorkloadIdentitySetup']),
  SET_CREATING_SETUP_PR: new Set(['ReadyForSetup']),
  SET_SETUP_PR_CREATED: new Set(['SetupPRCreating']),
  SET_SETUP_PR_MERGED: new Set(['SetupPRAwaitingMerge', 'ReadyForSetup']),
  SET_AGENT_TRIGGERED: new Set(['AgentTaskCreating']),
  SET_GENERATED_PR_CREATED: new Set(['AgentRunning']),
  SET_GENERATED_PR_MERGED: new Set(['GeneratedPRAwaitingMerge', 'AgentRunning']),
  SET_PIPELINE_CONFIGURED: new Set(['GeneratedPRAwaitingMerge', 'AgentRunning']),
  SET_DEPLOYED: new Set(['PipelineRunning', 'Deployed']),
  SET_FAILED: null,
  RETRY: new Set(['Failed']),
  LOAD_STATE: null,
};

/**
 * Simple transitions that only set deploymentState — no extra payload.
 * Handled before the switch to avoid duplicating the same pattern.
 */
const SIMPLE_TRANSITIONS: Partial<Record<PipelineAction['type'], PipelineDeploymentState>> = {
  SET_APP_INSTALL_NEEDED: 'AppInstallationNeeded',
  SET_CHECKING_REPO: 'CheckingRepo',
  SET_IDENTITY_SETUP: 'WorkloadIdentitySetup',
  SET_IDENTITY_READY: 'ReadyForSetup',
  SET_CREATING_SETUP_PR: 'SetupPRCreating',
};

function pipelineReducer(state: PipelineState, action: PipelineAction): PipelineState {
  const validSources = VALID_TRANSITIONS[action.type];
  if (validSources && !validSources.has(state.deploymentState)) {
    console.warn(`Invalid pipeline transition: ${action.type} from ${state.deploymentState}`);
    return state;
  }

  let next: PipelineState;

  const simpleTarget = SIMPLE_TRANSITIONS[action.type];
  if (simpleTarget) {
    next = { ...state, deploymentState: simpleTarget, updatedAt: now() };
  } else {
    switch (action.type) {
      case 'SET_CONFIG':
        next = {
          ...state,
          deploymentState: 'Configured',
          config: action.config,
          createdAt: state.createdAt ?? now(),
          updatedAt: now(),
        };
        break;

      case 'UPDATE_CONFIG':
        next = {
          ...state,
          config: state.config ? { ...state.config, ...action.partial } : null,
          updatedAt: now(),
        };
        break;

      case 'SET_AUTH_NEEDED':
        next = {
          ...state,
          deploymentState: 'GitHubAuthorizationNeeded',
          updatedAt: now(),
        };
        break;

      case 'SET_AUTH_COMPLETED': {
        const target = state.lastSuccessfulState ?? 'Configured';
        next = {
          ...state,
          deploymentState: target,
          updatedAt: now(),
        };
        break;
      }

      case 'SET_REPO_READINESS': {
        const { readiness } = action;
        if (readiness.hasDeployWorkflow) {
          next = {
            ...state,
            deploymentState: 'PipelineConfigured',
            repoReadiness: readiness,
            updatedAt: now(),
          };
          break;
        }
        const hasIdentity = Boolean(state.config?.identityId?.trim());
        const configComplete = hasIdentity && Boolean(state.config?.appName?.trim());
        if (readiness.hasSetupWorkflow && readiness.hasAgentConfig && configComplete) {
          next = {
            ...state,
            deploymentState: 'AgentTaskCreating',
            repoReadiness: readiness,
            updatedAt: now(),
          };
          break;
        }
        if (!hasIdentity) {
          next = {
            ...state,
            deploymentState: 'WorkloadIdentitySetup',
            repoReadiness: readiness,
            updatedAt: now(),
          };
          break;
        }
        next = {
          ...state,
          deploymentState: 'ReadyForSetup',
          repoReadiness: readiness,
          updatedAt: now(),
        };
        break;
      }

      case 'SET_SETUP_PR_CREATED':
        next = {
          ...state,
          deploymentState: 'SetupPRAwaitingMerge',
          setupPr: action.pr,
          updatedAt: now(),
        };
        break;

      case 'SET_SETUP_PR_MERGED':
        next = {
          ...state,
          deploymentState: 'AgentTaskCreating',
          setupPr: { ...state.setupPr, merged: true },
          updatedAt: now(),
        };
        break;

      case 'SET_AGENT_TRIGGERED':
        next = {
          ...state,
          deploymentState: 'AgentRunning',
          triggerIssue: action.issue,
          // Clear stale data from any previous pipeline run for this repo
          generatedPr: INITIAL_STATE.generatedPr,
          serviceEndpoint: null,
          updatedAt: now(),
        };
        break;

      case 'SET_GENERATED_PR_CREATED':
        next = {
          ...state,
          deploymentState: 'GeneratedPRAwaitingMerge',
          generatedPr: { url: action.prUrl, number: action.prNumber, merged: false },
          updatedAt: now(),
        };
        break;

      case 'SET_GENERATED_PR_MERGED':
        next = {
          ...state,
          deploymentState: 'PipelineRunning',
          generatedPr: { ...state.generatedPr, merged: true },
          updatedAt: now(),
        };
        break;

      case 'SET_PIPELINE_CONFIGURED':
        next = {
          ...state,
          deploymentState: 'PipelineConfigured',
          generatedPr: { ...state.generatedPr, merged: true },
          updatedAt: now(),
        };
        break;

      case 'SET_DEPLOYED':
        next = {
          ...state,
          deploymentState: 'Deployed',
          serviceEndpoint: action.serviceEndpoint ?? state.serviceEndpoint,
          updatedAt: now(),
        };
        break;

      case 'SET_FAILED':
        next = {
          ...state,
          deploymentState: 'Failed',
          error: action.error,
          updatedAt: now(),
        };
        break;

      case 'RETRY': {
        const retryTarget = state.lastSuccessfulState ?? 'Configured';
        return {
          ...state,
          deploymentState: retryTarget,
          error: null,
          updatedAt: now(),
        };
      }

      case 'LOAD_STATE':
        return action.state;

      default:
        return state;
    }
  }

  if (!NON_RESUMABLE_STATES.has(next.deploymentState)) {
    next.lastSuccessfulState = next.deploymentState;
  }
  return next;
}

export interface UseGitHubPipelineStateResult {
  state: PipelineState;
  /** Resets state to Configured. */
  setConfig: (config: PipelineConfig) => void;
  updateConfig: (config: Partial<PipelineConfig>) => void;
  setAuthNeeded: () => void;
  setAuthCompleted: () => void;
  setAppInstallNeeded: () => void;
  setCheckingRepo: () => void;
  setRepoReadiness: (readiness: RepoReadiness) => void;
  setIdentitySetup: () => void;
  setIdentityReady: () => void;
  setCreatingSetupPR: () => void;
  setSetupPRCreated: (pr: PRTracking) => void;
  setSetupPRMerged: () => void;
  setAgentTriggered: (issue: IssueTracking) => void;
  setGeneratedPRCreated: (prUrl: string, prNumber: number) => void;
  setGeneratedPRMerged: () => void;
  setPipelineConfigured: () => void;
  setDeployed: (serviceEndpoint?: string) => void;
  setFailed: (error: string) => void;
  retry: () => void;
}

/**
 * Manages pipeline deployment state transitions with localStorage persistence.
 * Uses a reducer with a transition table to guard against invalid state changes.
 * State transitions only — no async API logic.
 *
 * @param repoKey - '{owner}/{repo}' used as localStorage key. Pass null before repo is selected.
 */
export const useGitHubPipelineState = (repoKey: string | null): UseGitHubPipelineStateResult => {
  const [pipelineState, dispatch] = useReducer(pipelineReducer, repoKey, (key: string | null) => {
    if (key) {
      const persisted = loadPersistedState(key);
      if (persisted) return persisted;
    }
    return INITIAL_STATE;
  });

  const prevRepoKeyRef = useRef(repoKey);
  const lastLoadedStateRef = useRef<PipelineState | null>(null);

  // Load persisted state when repoKey changes — useLayoutEffect runs
  // synchronously before paint and before regular effects, avoiding both
  // dispatch-during-render warnings and stale-state races.
  useLayoutEffect(() => {
    if (repoKey === prevRepoKeyRef.current) return;
    prevRepoKeyRef.current = repoKey;
    const persisted = repoKey ? loadPersistedState(repoKey) : null;
    const loaded = persisted ?? INITIAL_STATE;
    lastLoadedStateRef.current = loaded;
    dispatch({ type: 'LOAD_STATE', state: loaded });
  }, [repoKey]);

  const latestStateRef = useRef(pipelineState);
  latestStateRef.current = pipelineState;

  const repoKeyRef = useRef(repoKey);
  useEffect(() => {
    repoKeyRef.current = repoKey;
  }, [repoKey]);

  // Debounced persistence — flush synchronously on unmount.
  useEffect(() => {
    if (!repoKey) return;
    if (lastLoadedStateRef.current === pipelineState) {
      lastLoadedStateRef.current = null;
      return;
    }
    const id = setTimeout(() => persistState(repoKey, pipelineState), 1000);
    return () => {
      clearTimeout(id);
      persistState(repoKeyRef.current!, latestStateRef.current);
    };
  }, [repoKey, pipelineState]);

  const actions = useMemo(
    () => ({
      setConfig: (config: PipelineConfig) => dispatch({ type: 'SET_CONFIG', config }),
      updateConfig: (partial: Partial<PipelineConfig>) =>
        dispatch({ type: 'UPDATE_CONFIG', partial }),
      setAuthNeeded: () => dispatch({ type: 'SET_AUTH_NEEDED' }),
      setAuthCompleted: () => dispatch({ type: 'SET_AUTH_COMPLETED' }),
      setAppInstallNeeded: () => dispatch({ type: 'SET_APP_INSTALL_NEEDED' }),
      setCheckingRepo: () => dispatch({ type: 'SET_CHECKING_REPO' }),
      setRepoReadiness: (readiness: RepoReadiness) =>
        dispatch({ type: 'SET_REPO_READINESS', readiness }),
      setIdentitySetup: () => dispatch({ type: 'SET_IDENTITY_SETUP' }),
      setIdentityReady: () => dispatch({ type: 'SET_IDENTITY_READY' }),
      setCreatingSetupPR: () => dispatch({ type: 'SET_CREATING_SETUP_PR' }),
      setSetupPRCreated: (pr: PRTracking) => dispatch({ type: 'SET_SETUP_PR_CREATED', pr }),
      setSetupPRMerged: () => dispatch({ type: 'SET_SETUP_PR_MERGED' }),
      setAgentTriggered: (issue: IssueTracking) => dispatch({ type: 'SET_AGENT_TRIGGERED', issue }),
      setGeneratedPRCreated: (prUrl: string, prNumber: number) =>
        dispatch({ type: 'SET_GENERATED_PR_CREATED', prUrl, prNumber }),
      setGeneratedPRMerged: () => dispatch({ type: 'SET_GENERATED_PR_MERGED' }),
      setPipelineConfigured: () => dispatch({ type: 'SET_PIPELINE_CONFIGURED' }),
      setDeployed: (serviceEndpoint?: string) =>
        dispatch({ type: 'SET_DEPLOYED', serviceEndpoint }),
      setFailed: (error: string) => dispatch({ type: 'SET_FAILED', error }),
      retry: () => dispatch({ type: 'RETRY' }),
    }),
    []
  );

  return {
    state: pipelineState,
    ...actions,
  };
};
