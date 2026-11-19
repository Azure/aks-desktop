// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// In-memory state of the Developer Cluster workflow. Nothing is persisted: a reload starts from the
// initial state, and the kubeconfig keeps the target. Every update replaces the frozen state
// object, so its identity changes only on an update.

import { KubernetesVersionOption } from '../cli/commands';
import { HostEnvironment, LocalTarget } from '../contract/capability';
import { WorkflowFailure } from './failure';

/** Create shows one progress text while `running`, including readiness polling. */
export type CreatePhase = 'idle' | 'running' | 'usable' | 'not-confirmed' | 'failed';

export type DeletePhase = 'idle' | 'running' | 'deleted' | 'failed';

export interface WorkflowState {
  /** An operation is running; every other operation is refused. */
  readonly busy: boolean;
  /** Overview has completed its first kubeconfig refresh in this app session. */
  readonly overviewInitialized: boolean;
  /** The environment step's x64 answer: undefined before its first check, null if unknown. */
  readonly windowsX64: boolean | null | undefined;
  /** The environment step's last result; null before it and once Setup, Create or Delete starts. */
  readonly environment: Readonly<HostEnvironment> | null;
  /** The CLI catalog, newest first; null until Setup reads it. */
  readonly versions: readonly KubernetesVersionOption[] | null;
  /** The Developer Cluster whose context Headlamp loaded from the kubeconfig. */
  readonly target: Readonly<LocalTarget> | null;
  readonly refreshFailure: WorkflowFailure | null;
  readonly createPhase: CreatePhase;
  readonly createFailure: WorkflowFailure | null;
  readonly deletePhase: DeletePhase;
  readonly deleteFailure: WorkflowFailure | null;
}

const INITIAL: WorkflowState = Object.freeze({
  busy: false,
  overviewInitialized: false,
  windowsX64: undefined,
  environment: null,
  versions: null,
  target: null,
  refreshFailure: null,
  createPhase: 'idle',
  createFailure: null,
  deletePhase: 'idle',
  deleteFailure: null,
});

interface Subscription {
  readonly listener: () => void;
}

let state: WorkflowState = INITIAL;
let subscriptions: readonly Subscription[] = [];

/** The current state, for `useSyncExternalStore`. */
export function getWorkflowState(): WorkflowState {
  return state;
}

/** Calls `listener` after every update; the returned function unsubscribes, at most once. */
export function subscribeWorkflow(listener: () => void): () => void {
  const subscription: Subscription = { listener };
  subscriptions = subscriptions.concat(subscription);
  return () => {
    subscriptions = subscriptions.filter(item => item !== subscription);
  };
}

/** Applies `patch` and notifies every subscriber. Only workflow modules update the state. */
export function update(patch: Partial<WorkflowState>): void {
  state = Object.freeze({ ...state, ...patch });
  for (const subscription of subscriptions) subscription.listener();
}

/** A frozen copy of a decoded target. */
export function freezeTarget(target: LocalTarget): Readonly<LocalTarget> {
  return Object.freeze({ ...target });
}

/** A frozen copy of a decoded inspection, including its nested objects. */
export function freezeEnvironment(environment: HostEnvironment): Readonly<HostEnvironment> {
  const { target } = environment;
  return Object.freeze({
    ...environment,
    target: target === null ? null : freezeTarget(target),
  });
}
