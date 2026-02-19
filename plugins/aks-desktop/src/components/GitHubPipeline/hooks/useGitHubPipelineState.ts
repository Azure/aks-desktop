// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { RepoReadiness } from '../../../types/github';
import type {
  IssueTracking,
  PipelineConfig,
  PipelineDeploymentState,
  PipelineState,
  PRTracking,
} from '../types';

const STORAGE_KEY_PREFIX = 'aks-desktop:pipeline-state:';
const SCHEMA_VERSION = 1;

/**
 * Maps transient (in-flight) states to their actionable parent for RETRY.
 * Transient states are dead-ends for RETRY because the orchestration effect
 * only transitions *into* them, not *from* them.
 */
const RETRYABLE_STATE_MAP: Partial<Record<PipelineDeploymentState, PipelineDeploymentState>> = {
  CheckingRepo: 'Configured',
  SetupPRCreating: 'ReadyForSetup',
};

/**
 * States that should NOT be recorded as lastSuccessfulState because they are
 * transient (in-flight) and would cause RETRY to land on a dead-end.
 */
const TRANSIENT_STATES: ReadonlySet<PipelineDeploymentState> = new Set([
  'CheckingRepo',
  'SetupPRCreating',
]);

const VALID_DEPLOYMENT_STATES: ReadonlySet<string> = new Set<PipelineDeploymentState>([
  'Configured',
  'GitHubAuthorizationNeeded',
  'AppInstallationNeeded',
  'CheckingRepo',
  'ReadyForSetup',
  'SetupPRCreating',
  'SetupPRAwaitingMerge',
  'AgentTaskCreating',
  'AgentRunning',
  'GeneratedPRAwaitingMerge',
  'PipelineConfigured',
  'PipelineRunning',
  'Deployed',
  'Failed',
]);

const INITIAL_STATE: PipelineState = {
  deploymentState: 'Configured',
  config: null,
  repoReadiness: null,
  setupPr: { url: null, number: null, merged: false },
  triggerIssue: { url: null, number: null },
  generatedPr: { url: null, number: null, merged: false },
  workflowRun: { url: null, id: null, status: null, conclusion: null },
  deployment: { podStatus: null, serviceEndpoint: null, healthSummary: null },
  lastSuccessfulState: null,
  error: null,
  createdAt: null,
  updatedAt: null,
};

const loadPersistedState = (repoKey: string): PipelineState | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PREFIX + repoKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (parsed?.__schemaVersion !== SCHEMA_VERSION) return null;
    if (!VALID_DEPLOYMENT_STATES.has(parsed.deploymentState)) return null;
    return parsed as PipelineState;
  } catch {
    return null;
  }
};

const persistState = (repoKey: string, state: PipelineState): void => {
  try {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + repoKey,
      JSON.stringify({ __schemaVersion: SCHEMA_VERSION, ...state })
    );
  } catch {
    // localStorage may be full or unavailable — ignore
  }
};

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

type PipelineAction =
  | { type: 'SET_CONFIG'; config: PipelineConfig }
  | { type: 'UPDATE_CONFIG'; partial: Partial<PipelineConfig> }
  | { type: 'SET_AUTH_NEEDED' }
  | { type: 'SET_AUTH_COMPLETED' }
  | { type: 'SET_APP_INSTALL_NEEDED' }
  | { type: 'SET_CHECKING_REPO' }
  | { type: 'SET_REPO_READINESS'; readiness: RepoReadiness }
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

// ---------------------------------------------------------------------------
// Transition table — null means "allowed from any state"
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<
  PipelineAction['type'],
  ReadonlySet<PipelineDeploymentState> | null
> = {
  SET_CONFIG: new Set(['Configured', 'GitHubAuthorizationNeeded']),
  UPDATE_CONFIG: null,
  SET_AUTH_NEEDED: new Set(['Configured', 'GitHubAuthorizationNeeded']),
  SET_AUTH_COMPLETED: new Set(['GitHubAuthorizationNeeded']),
  SET_APP_INSTALL_NEEDED: new Set(['CheckingRepo']),
  SET_CHECKING_REPO: new Set(['Configured', 'AppInstallationNeeded']),
  SET_REPO_READINESS: new Set(['CheckingRepo']),
  SET_CREATING_SETUP_PR: new Set(['ReadyForSetup']),
  SET_SETUP_PR_CREATED: new Set(['SetupPRCreating']),
  SET_SETUP_PR_MERGED: new Set(['SetupPRAwaitingMerge', 'ReadyForSetup']),
  SET_AGENT_TRIGGERED: new Set(['AgentTaskCreating']),
  SET_GENERATED_PR_CREATED: new Set(['AgentRunning']),
  SET_GENERATED_PR_MERGED: new Set(['GeneratedPRAwaitingMerge']),
  SET_PIPELINE_CONFIGURED: new Set(['GeneratedPRAwaitingMerge']),
  SET_DEPLOYED: new Set(['PipelineRunning', 'Deployed']),
  SET_FAILED: null,
  RETRY: new Set(['Failed']),
  LOAD_STATE: null,
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function pipelineReducer(state: PipelineState, action: PipelineAction): PipelineState {
  const validSources = VALID_TRANSITIONS[action.type];
  if (validSources && !validSources.has(state.deploymentState)) {
    console.warn(`Invalid pipeline transition: ${action.type} from ${state.deploymentState}`);
    return state;
  }

  let next: PipelineState;

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
      // Don't update lastSuccessfulState — auth-needed is not a "success" state.
      // Preserves the pre-auth state so SET_AUTH_COMPLETED returns to the right place.
      return {
        ...state,
        deploymentState: 'GitHubAuthorizationNeeded',
        updatedAt: now(),
      };

    case 'SET_AUTH_COMPLETED': {
      const target = state.lastSuccessfulState ?? 'Configured';
      next = {
        ...state,
        deploymentState: RETRYABLE_STATE_MAP[target] ?? target,
        updatedAt: now(),
      };
      break;
    }

    case 'SET_APP_INSTALL_NEEDED':
      next = {
        ...state,
        deploymentState: 'AppInstallationNeeded',
        updatedAt: now(),
      };
      break;

    case 'SET_CHECKING_REPO':
      next = {
        ...state,
        deploymentState: 'CheckingRepo',
        updatedAt: now(),
      };
      break;

    case 'SET_REPO_READINESS': {
      const { readiness } = action;
      const configComplete = state.config?.identityId?.trim() && state.config?.appName?.trim();
      if (readiness.hasSetupWorkflow && readiness.hasAgentConfig && configComplete) {
        next = {
          ...state,
          deploymentState: 'AgentTaskCreating',
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

    case 'SET_CREATING_SETUP_PR':
      next = {
        ...state,
        deploymentState: 'SetupPRCreating',
        updatedAt: now(),
      };
      break;

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
        deployment: {
          ...state.deployment,
          serviceEndpoint: action.serviceEndpoint ?? state.deployment.serviceEndpoint,
        },
        updatedAt: now(),
      };
      break;

    case 'SET_FAILED':
      // Don't update lastSuccessfulState on failure — preserve the pre-failure state
      return {
        ...state,
        deploymentState: 'Failed',
        error: action.error,
        updatedAt: now(),
      };

    case 'RETRY': {
      const raw = state.lastSuccessfulState ?? 'Configured';
      const target = RETRYABLE_STATE_MAP[raw] ?? raw;
      return {
        ...state,
        deploymentState: target,
        error: null,
        updatedAt: now(),
      };
    }

    case 'LOAD_STATE':
      return action.state;
  }

  // Track the last successful (non-Failed, non-transient) state for RETRY
  if (!TRANSIENT_STATES.has(next.deploymentState)) {
    next.lastSuccessfulState = next.deploymentState;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Return type for the {@link useGitHubPipelineState} hook.
 */
interface UseGitHubPipelineStateResult {
  /** Current pipeline state. */
  state: PipelineState;
  /** Sets the pipeline configuration (resets state to Configured). */
  setConfig: (config: PipelineConfig) => void;
  /** Updates the pipeline configuration without changing deployment state. */
  updateConfig: (config: Partial<PipelineConfig>) => void;
  /** Signals that GitHub authorization is needed. */
  setAuthNeeded: () => void;
  /** Transitions to Configured after successful auth (no config payload needed). */
  setAuthCompleted: () => void;
  /** Signals that the GitHub App needs to be installed on the repo. */
  setAppInstallNeeded: () => void;
  /** Transitions to CheckingRepo state while repo readiness is being fetched. */
  setCheckingRepo: () => void;
  /** Sets repo readiness result (Step B) and transitions accordingly. */
  setRepoReadiness: (readiness: RepoReadiness) => void;
  /** Transitions to SetupPRCreating state. */
  setCreatingSetupPR: () => void;
  /** Records that the setup PR was created (Step C). */
  setSetupPRCreated: (pr: PRTracking) => void;
  /** Records that the setup PR was merged, transitions to AgentTaskCreating (Step D). */
  setSetupPRMerged: () => void;
  /** Records that the agent trigger issue was created (Step D). */
  setAgentTriggered: (issue: IssueTracking) => void;
  /** Records that the agent's generated PR was detected (Step E). */
  setGeneratedPRCreated: (prUrl: string, prNumber: number) => void;
  /** Records that the generated PR was merged (Step E→F). */
  setGeneratedPRMerged: () => void;
  /** Records that pipeline configuration is complete (configure-only mode). */
  setPipelineConfigured: () => void;
  /** Records successful deployment (Step F). */
  setDeployed: (serviceEndpoint?: string) => void;
  /** Records a failure at any step. */
  setFailed: (error: string) => void;
  /**
   * Resets error and returns to the most recent actionable state for retry.
   */
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

  // Synchronous state load when repoKey changes. By dispatching during render
  // (before effects run), we ensure other effects always see the correct persisted
  // state — avoiding races where effects dispatch to stale INITIAL_STATE.
  const prevRepoKeyRef = useRef(repoKey);
  const lastLoadedStateRef = useRef<PipelineState | null>(null);

  if (repoKey !== prevRepoKeyRef.current) {
    prevRepoKeyRef.current = repoKey;
    const persisted = repoKey ? loadPersistedState(repoKey) : null;
    const loaded = persisted ?? INITIAL_STATE;
    lastLoadedStateRef.current = loaded;
    dispatch({ type: 'LOAD_STATE', state: loaded });
  }

  // Persist state changes to localStorage (skip the render immediately after load).
  useEffect(() => {
    if (!repoKey) return;
    if (lastLoadedStateRef.current === pipelineState) {
      lastLoadedStateRef.current = null;
      return;
    }
    persistState(repoKey, pipelineState);
  }, [repoKey, pipelineState]);

  // Stable dispatch wrappers — dispatch is guaranteed stable by React,
  // so these callbacks never change and won't trigger unnecessary re-renders.
  const setConfig = useCallback(
    (config: PipelineConfig) => dispatch({ type: 'SET_CONFIG', config }),
    []
  );
  const updateConfig = useCallback(
    (partial: Partial<PipelineConfig>) => dispatch({ type: 'UPDATE_CONFIG', partial }),
    []
  );
  const setAuthNeeded = useCallback(() => dispatch({ type: 'SET_AUTH_NEEDED' }), []);
  const setAuthCompleted = useCallback(() => dispatch({ type: 'SET_AUTH_COMPLETED' }), []);
  const setAppInstallNeeded = useCallback(() => dispatch({ type: 'SET_APP_INSTALL_NEEDED' }), []);
  const setCheckingRepo = useCallback(() => dispatch({ type: 'SET_CHECKING_REPO' }), []);
  const setRepoReadiness = useCallback(
    (readiness: RepoReadiness) => dispatch({ type: 'SET_REPO_READINESS', readiness }),
    []
  );
  const setCreatingSetupPR = useCallback(() => dispatch({ type: 'SET_CREATING_SETUP_PR' }), []);
  const setSetupPRCreated = useCallback(
    (pr: PRTracking) => dispatch({ type: 'SET_SETUP_PR_CREATED', pr }),
    []
  );
  const setSetupPRMerged = useCallback(() => dispatch({ type: 'SET_SETUP_PR_MERGED' }), []);
  const setAgentTriggered = useCallback(
    (issue: IssueTracking) => dispatch({ type: 'SET_AGENT_TRIGGERED', issue }),
    []
  );
  const setGeneratedPRCreated = useCallback(
    (prUrl: string, prNumber: number) =>
      dispatch({ type: 'SET_GENERATED_PR_CREATED', prUrl, prNumber }),
    []
  );
  const setGeneratedPRMerged = useCallback(() => dispatch({ type: 'SET_GENERATED_PR_MERGED' }), []);
  const setPipelineConfigured = useCallback(
    () => dispatch({ type: 'SET_PIPELINE_CONFIGURED' }),
    []
  );
  const setDeployed = useCallback(
    (serviceEndpoint?: string) => dispatch({ type: 'SET_DEPLOYED', serviceEndpoint }),
    []
  );
  const setFailed = useCallback((error: string) => dispatch({ type: 'SET_FAILED', error }), []);
  const retry = useCallback(() => dispatch({ type: 'RETRY' }), []);

  return {
    state: pipelineState,
    setConfig,
    updateConfig,
    setAuthNeeded,
    setAuthCompleted,
    setAppInstallNeeded,
    setCheckingRepo,
    setRepoReadiness,
    setCreatingSetupPR,
    setSetupPRCreated,
    setSetupPRMerged,
    setAgentTriggered,
    setGeneratedPRCreated,
    setGeneratedPRMerged,
    setPipelineConfigured,
    setDeployed,
    setFailed,
    retry,
  };
};
