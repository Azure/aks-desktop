// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Create: a fresh read of the target, then the CLI create, without repeating the environment step's
// checks. The CLI merges the cluster's context into the user's default kubeconfig; a GPU cluster
// adds the NVIDIA GPU flag. Readiness then reads Headlamp's contexts every 2 seconds for at most 30
// seconds, until the new context is loaded. Nothing is retried or deleted automatically.

import { createCluster } from '../cli/commands';
import { configurationValid } from '../common/gates';
import { LocalTarget } from '../contract/capability';
import { readLocalTarget } from '../native/localContext';
import { classifyFailure, hostError, nativeError, WorkflowFailure } from './failure';
import { exclusive } from './guard';
import { refreshTarget } from './setup';
import { freezeTarget, getWorkflowState, update, WorkflowState } from './store';

export const READINESS_INTERVAL_MS = 2000;
/** Three of Headlamp's 10 s kubeconfig reload cycles. */
export const READINESS_LIMIT_MS = 30000;

export interface CreateInput {
  readonly name: string;
  /** The selected catalog entry's `version`. */
  readonly kubernetesVersion: string;
  /** NVIDIA GPU support; absent or false creates a standard cluster. */
  readonly gpu?: boolean;
}

/** Fails when the kubeconfig already has a local cluster's context. */
async function checkNoTarget(): Promise<void> {
  if ((await refreshTarget()) !== null) throw hostError('already-exists');
}

/** The loaded context is the cluster this run created. */
function sameCluster(target: LocalTarget, input: CreateInput): boolean {
  return target.name === input.name && target.kubernetesVersion === input.kubernetesVersion;
}

/**
 * Reads Headlamp's contexts until the new cluster's context is loaded, for at most
 * READINESS_LIMIT_MS; Headlamp reloads the kubeconfig when the CLI changes it. A loaded context is
 * reported usable without probing the API server, as before. A loaded local context for another
 * name or version is `invalid-metadata`. A failed read ends the polling, because the plugin never
 * retries it; the page then offers Check again.
 */
async function awaitReadiness(input: CreateInput): Promise<Partial<WorkflowState>> {
  const deadline = Date.now() + READINESS_LIMIT_MS;
  for (;;) {
    let target: LocalTarget | null;
    try {
      target = await readLocalTarget();
    } catch (error) {
      return { createPhase: 'not-confirmed', createFailure: classifyFailure(error) };
    }
    if (target !== null) {
      // Overview shows the loaded context, and Delete stays available, even when the check below
      // fails.
      update({ target: freezeTarget(target) });
      if (!sameCluster(target, input)) throw nativeError('invalid-metadata');
      return { createPhase: 'usable' };
    }
    if (Date.now() + READINESS_INTERVAL_MS > deadline) return { createPhase: 'not-confirmed' };
    await new Promise(resolve => setTimeout(resolve, READINESS_INTERVAL_MS));
  }
}

function createFailed(failure: WorkflowFailure): Partial<WorkflowState> {
  return { createPhase: 'failed', createFailure: failure };
}

/**
 * Creates the local cluster, then waits until Headlamp loads its context. Resolves true when Create
 * ran to the end, `usable` or `not-confirmed`, and false when it was refused or failed
 * (`createFailure`). Success is reported only once readiness says `usable`.
 */
export function createLocalCluster(input: CreateInput): Promise<boolean> {
  if (!configurationValid(input, getWorkflowState())) return Promise.resolve(false);
  return exclusive(async () => {
    // Create changes this computer, so a later Setup needs the environment step's checks again.
    update({
      createPhase: 'running',
      createFailure: null,
      deletePhase: 'idle',
      deleteFailure: null,
      environment: null,
    });
    await checkNoTarget();
    const { name, kubernetesVersion } = input;
    await createCluster({ name, kubernetesVersion, gpu: input.gpu === true });
    update(await awaitReadiness(input));
  }, createFailed);
}

/**
 * Check again after readiness was not confirmed: one read, without polling. A loaded
 * local context becomes the target, so Overview shows it and Delete becomes available.
 */
export function checkReadinessAgain(): Promise<boolean> {
  const { createPhase } = getWorkflowState();
  if (createPhase !== 'not-confirmed') return Promise.resolve(false);
  return exclusive(
    async () => {
      update({ createFailure: null });
      const target = await readLocalTarget();
      update(
        target === null
          ? { createPhase: 'not-confirmed' }
          : { createPhase: 'usable', target: freezeTarget(target) }
      );
    },
    failure => ({ createPhase: 'not-confirmed', createFailure: failure })
  );
}
