// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import type { PipelineConfig, PRTracking } from '../types';

/** Storage key prefix — separate from the agent-path pipeline state. */
const FAST_PATH_STORAGE_PREFIX = 'aks-desktop:fast-path-state:';

/** Schema version for fast-path state. Bump when the shape changes. */
const FAST_PATH_SCHEMA_VERSION = 1;

export const FAST_PATH_DEPLOYMENT_STATES = [
  'Configured',
  'DockerfileDetected',
  'FastPathGenerating',
  'FastPathPRCreating',
  'FastPathPRAwaitingMerge',
  'PipelineRunning',
  'Deployed',
  'AsyncAgentTriggered',
  'Failed',
] as const;

export type FastPathDeploymentState = (typeof FAST_PATH_DEPLOYMENT_STATES)[number];

export interface FastPathState {
  deploymentState: FastPathDeploymentState;
  config: PipelineConfig | null;
  dockerfilePaths: string[];
  fastPathPr: PRTracking;
  asyncAgentIssueUrl: string | null;
  serviceEndpoint: string | null;
  lastSuccessfulState: FastPathDeploymentState | null;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

type FastPathAction =
  | { type: 'SET_CONFIG'; config: PipelineConfig }
  | { type: 'UPDATE_CONFIG'; partial: Partial<PipelineConfig> }
  | { type: 'SET_DOCKERFILE_DETECTED'; paths: string[] }
  | { type: 'SET_GENERATING' }
  | { type: 'SET_PR_CREATING' }
  | { type: 'SET_PR_CREATED'; pr: PRTracking }
  | { type: 'SET_PR_MERGED' }
  | { type: 'SET_PIPELINE_RUNNING' }
  | { type: 'SET_DEPLOYED'; serviceEndpoint?: string }
  | { type: 'SET_ASYNC_AGENT_TRIGGERED'; issueUrl: string }
  | { type: 'SET_FAILED'; error: string }
  | { type: 'RETRY' }
  | { type: 'LOAD_STATE'; state: FastPathState };

/**
 * Transient (in-flight) states that should not be recorded as lastSuccessfulState
 * because RETRY would land on a dead-end (the orchestration effect only transitions
 * *into* them, not *from* them).
 */
const TRANSIENT_STATES: ReadonlySet<FastPathDeploymentState> = new Set([
  'FastPathGenerating',
  'FastPathPRCreating',
]);

const NON_RESUMABLE_STATES: ReadonlySet<FastPathDeploymentState> = new Set([
  ...TRANSIENT_STATES,
  'Failed',
]);

const VALID_DEPLOYMENT_STATES = new Set<string>(FAST_PATH_DEPLOYMENT_STATES);

/** Terminal states that don't need persistence — nothing to resume. */
const TERMINAL_STATES: ReadonlySet<FastPathDeploymentState> = new Set([
  'Deployed',
  'AsyncAgentTriggered',
]);

const INITIAL_STATE: FastPathState = {
  deploymentState: 'Configured',
  config: null,
  dockerfilePaths: [],
  fastPathPr: { url: null, number: null, merged: false },
  asyncAgentIssueUrl: null,
  serviceEndpoint: null,
  lastSuccessfulState: null,
  error: null,
  createdAt: null,
  updatedAt: null,
};

const VALID_TRANSITIONS: Record<
  FastPathAction['type'],
  ReadonlySet<FastPathDeploymentState> | null
> = {
  SET_CONFIG: new Set(['Configured']),
  UPDATE_CONFIG: null,
  SET_DOCKERFILE_DETECTED: new Set(['Configured']),
  SET_GENERATING: new Set(['DockerfileDetected']),
  SET_PR_CREATING: new Set(['FastPathGenerating']),
  SET_PR_CREATED: new Set(['FastPathPRCreating']),
  SET_PR_MERGED: new Set(['FastPathPRAwaitingMerge']),
  SET_PIPELINE_RUNNING: new Set(['FastPathPRAwaitingMerge']),
  SET_DEPLOYED: new Set(['PipelineRunning']),
  SET_ASYNC_AGENT_TRIGGERED: new Set(['Deployed']),
  SET_FAILED: null,
  RETRY: new Set(['Failed']),
  LOAD_STATE: null,
};

const SIMPLE_TRANSITIONS: Partial<Record<FastPathAction['type'], FastPathDeploymentState>> = {
  SET_GENERATING: 'FastPathGenerating',
  SET_PR_CREATING: 'FastPathPRCreating',
};

const now = () => new Date().toISOString();

/**
 * Loads a previously persisted fast-path state from localStorage for the given repo key.
 *
 * Returns `null` when nothing was persisted, when the schema version doesn't match,
 * when the stored `deploymentState` is unrecognized, or when the state is terminal
 * (those are purged on load so a fresh deploy always starts clean).
 *
 * Never throws; a parse failure is logged and treated as "no persisted state". Logging
 * the error (rather than silently swallowing) is important because a corrupted blob
 * is otherwise near-impossible to diagnose from the UI.
 */
function loadPersistedState(repoKey: string): FastPathState | null {
  try {
    const stored = localStorage.getItem(FAST_PATH_STORAGE_PREFIX + repoKey);
    if (!stored) return null;

    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const data = parsed as Record<string, unknown>;
    if (data.__schemaVersion !== FAST_PATH_SCHEMA_VERSION) return null;
    if (typeof data.deploymentState !== 'string') return null;
    if (!VALID_DEPLOYMENT_STATES.has(data.deploymentState)) return null;

    const deploymentState = data.deploymentState as FastPathDeploymentState;
    if (TERMINAL_STATES.has(deploymentState)) {
      localStorage.removeItem(FAST_PATH_STORAGE_PREFIX + repoKey);
      return null;
    }

    return {
      ...INITIAL_STATE,
      ...data,
      deploymentState,
      fastPathPr: {
        ...INITIAL_STATE.fastPathPr,
        ...(typeof data.fastPathPr === 'object' && data.fastPathPr !== null
          ? (data.fastPathPr as Record<string, unknown>)
          : {}),
      },
    } as FastPathState;
  } catch (err) {
    console.warn('Failed to load persisted fast-path state:', err);
    return null;
  }
}

/**
 * Writes the current fast-path state to localStorage under the repo-specific key.
 *
 * Terminal states (`Deployed`, `AsyncAgentTriggered`) are not persisted — they are
 * actively purged here so a subsequent SET_CONFIG for the same repo starts clean
 * instead of resuming from a completed deploy. Storage-quota or serialization
 * errors are logged and swallowed; persistence is best-effort.
 */
function persistState(repoKey: string, state: FastPathState): void {
  try {
    if (TERMINAL_STATES.has(state.deploymentState)) {
      localStorage.removeItem(FAST_PATH_STORAGE_PREFIX + repoKey);
      return;
    }
    localStorage.setItem(
      FAST_PATH_STORAGE_PREFIX + repoKey,
      JSON.stringify({ __schemaVersion: FAST_PATH_SCHEMA_VERSION, ...state })
    );
  } catch (err) {
    console.warn('Failed to persist fast-path state:', err);
  }
}

function fastPathReducer(state: FastPathState, action: FastPathAction): FastPathState {
  const validSources = VALID_TRANSITIONS[action.type];
  if (validSources && !validSources.has(state.deploymentState)) {
    console.warn(`Invalid fast-path transition: ${action.type} from ${state.deploymentState}`);
    return state;
  }

  let next: FastPathState;

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

      case 'SET_DOCKERFILE_DETECTED':
        next = {
          ...state,
          deploymentState: 'DockerfileDetected',
          dockerfilePaths: action.paths,
          updatedAt: now(),
        };
        break;

      case 'SET_PR_CREATED':
        next = {
          ...state,
          deploymentState: 'FastPathPRAwaitingMerge',
          fastPathPr: action.pr,
          updatedAt: now(),
        };
        break;

      case 'SET_PR_MERGED':
        next = {
          ...state,
          deploymentState: 'PipelineRunning',
          fastPathPr: { ...state.fastPathPr, merged: true },
          updatedAt: now(),
        };
        break;

      case 'SET_PIPELINE_RUNNING':
        next = {
          ...state,
          deploymentState: 'PipelineRunning',
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

      case 'SET_ASYNC_AGENT_TRIGGERED':
        next = {
          ...state,
          deploymentState: 'AsyncAgentTriggered',
          asyncAgentIssueUrl: action.issueUrl,
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

export interface UseFastPathPipelineStateResult {
  state: FastPathState;
  setConfig: (config: PipelineConfig) => void;
  updateConfig: (config: Partial<PipelineConfig>) => void;
  setDockerfileDetected: (paths: string[]) => void;
  setGenerating: () => void;
  setPRCreating: () => void;
  setPRCreated: (pr: PRTracking) => void;
  setPRMerged: () => void;
  setDeployed: (serviceEndpoint?: string) => void;
  setAsyncAgentTriggered: (issueUrl: string) => void;
  setFailed: (error: string) => void;
  retry: () => void;
  loadState: (state: FastPathState) => void;
}

/**
 * Manages fast-path pipeline state transitions with localStorage persistence.
 * Parallel to useGitHubPipelineState but with fewer states for the deterministic
 * deploy flow.
 *
 * @param repoKey - '{owner}/{repo}' used as localStorage key. Pass null before repo is selected.
 */
export const useFastPathPipelineState = (
  repoKey: string | null
): UseFastPathPipelineStateResult => {
  const [pipelineState, dispatch] = useReducer(fastPathReducer, repoKey, (key: string | null) => {
    if (key) {
      const persisted = loadPersistedState(key);
      if (persisted) return persisted;
    }
    return INITIAL_STATE;
  });

  const prevRepoKeyRef = useRef(repoKey);
  const lastLoadedStateRef = useRef<FastPathState | null>(null);

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
      setDockerfileDetected: (paths: string[]) =>
        dispatch({ type: 'SET_DOCKERFILE_DETECTED', paths }),
      setGenerating: () => dispatch({ type: 'SET_GENERATING' }),
      setPRCreating: () => dispatch({ type: 'SET_PR_CREATING' }),
      setPRCreated: (pr: PRTracking) => dispatch({ type: 'SET_PR_CREATED', pr }),
      setPRMerged: () => dispatch({ type: 'SET_PR_MERGED' }),
      setDeployed: (serviceEndpoint?: string) =>
        dispatch({ type: 'SET_DEPLOYED', serviceEndpoint }),
      setAsyncAgentTriggered: (issueUrl: string) =>
        dispatch({ type: 'SET_ASYNC_AGENT_TRIGGERED', issueUrl }),
      setFailed: (error: string) => dispatch({ type: 'SET_FAILED', error }),
      retry: () => dispatch({ type: 'RETRY' }),
      loadState: (state: FastPathState) => dispatch({ type: 'LOAD_STATE', state }),
    }),
    []
  );

  return {
    state: pipelineState,
    ...actions,
  };
};
