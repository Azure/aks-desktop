// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Create: a fresh read of the target, then the CLI create, without repeating the environment step's
// checks. The CLI merges the cluster's context into the user's default kubeconfig; a GPU cluster
// adds the NVIDIA GPU flag. Readiness then reads Headlamp's contexts every 2 seconds for at most 30
// seconds, until the new context is loaded. Nothing is retried or deleted automatically.

import { createCluster } from '../cli/commands';
import { configurationValid } from '../common/gates';
import { LocalTarget } from '../contract/capability';
import { KubernetesDistribution } from '../contract/devctl';
import { readLocalTarget } from '../native/localContext';
import { classifyFailure, hostError, nativeError, WorkflowFailure } from './failure';
import { exclusive } from './guard';
import { refreshTarget } from './setup';
import { freezeTarget, getWorkflowState, update, WorkflowState } from './store';

export const READINESS_INTERVAL_MS = 2000;
/** Three of Headlamp's 10 s kubeconfig reload cycles. */
export const READINESS_LIMIT_MS = 30000;

/** The inputs of Create. */
export interface CreateInput {
  /** The cluster name. */
  readonly name: string;
  readonly distribution: KubernetesDistribution;
  /** The selected catalog entry's `version`. */
  readonly kubernetesVersion: string;
  /** NVIDIA GPU support; absent or false creates a standard cluster. */
  readonly gpu?: boolean;
}

/**
 * The name and version of the last Create that ran, which Check again confirms. Kept in memory,
 * like the workflow state.
 */
let lastCreate: Pick<CreateInput, 'name' | 'distribution' | 'kubernetesVersion'> | null = null;

/**
 * Fails when the kubeconfig already has a local cluster's context. Records the fresh read as the
 * target.
 */
async function checkNoTarget(): Promise<void> {
  if ((await refreshTarget()) !== null) throw hostError('already-exists');
}

/**
 * The loaded context is the cluster this run created.
 *
 * @param target - The loaded target.
 * @param input - The name and version Create used.
 * @returns True when the target has the same name and Kubernetes version.
 */
function sameCluster(target: LocalTarget, input: CreateInput): boolean {
  return (
    target.name === input.name &&
    target.kubernetesVersion === input.kubernetesVersion &&
    (target.distribution === null || target.distribution === input.distribution)
  );
}

/**
 * Reads Headlamp's contexts until the new cluster's context is loaded, for at most
 * READINESS_LIMIT_MS; Headlamp reloads the kubeconfig when the CLI changes it. A loaded context is
 * reported usable without probing the API server, as before. A loaded local context for another
 * name or version is `invalid-metadata`. A failed read ends the polling, because the plugin never
 * retries it; the page then offers Check again.
 *
 * @param input - The name and version Create used.
 * @returns A promise of the patch to apply: `usable`, or `not-confirmed` with the read failure if
 * any. It rejects with `invalid-metadata` for a context of another name or version.
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

/**
 * The state patch for a failed Create.
 *
 * @param failure - The classified failure.
 * @returns The patch that records the failure with the `failed` phase.
 */
function createFailed(failure: WorkflowFailure): Partial<WorkflowState> {
  return { createPhase: 'failed', createFailure: failure };
}

/**
 * Creates the local cluster, then waits until Headlamp loads its context. Resolves true when Create
 * ran to the end, `usable` or `not-confirmed`, and false when it was refused or failed
 * (`createFailure`). Success is reported only once readiness says `usable`.
 *
 * @param input - The cluster name, the selected catalog version and the GPU choice.
 * @returns A promise of whether Create ran to the end.
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
    const { name, distribution, kubernetesVersion } = input;
    lastCreate = Object.freeze({ name, distribution, kubernetesVersion });
    await checkNoTarget();
    await createCluster({ name, distribution, kubernetesVersion, gpu: input.gpu === true });
    update(await awaitReadiness(input));
  }, createFailed);
}

/**
 * Check again after readiness was not confirmed: one read, without polling. A loaded
 * local context becomes the target, so Overview shows it and Delete becomes available. As after
 * Create, a loaded local context for another name or version fails Create with
 * `invalid-metadata`; a failed read keeps readiness not confirmed.
 *
 * @returns A promise of true when the read ran to the end, and false when it was refused or failed.
 */
export function checkReadinessAgain(): Promise<boolean> {
  const { createPhase } = getWorkflowState();
  const input = lastCreate;
  if (createPhase !== 'not-confirmed' || input === null) return Promise.resolve(false);
  const run = { mismatch: false };
  return exclusive(
    async () => {
      update({ createFailure: null });
      const target = await readLocalTarget();
      if (target === null) {
        update({ createPhase: 'not-confirmed' });
        return;
      }
      update({ target: freezeTarget(target) });
      if (!sameCluster(target, input)) {
        run.mismatch = true;
        throw nativeError('invalid-metadata');
      }
      update({ createPhase: 'usable' });
    },
    failure => ({ createPhase: run.mismatch ? 'failed' : 'not-confirmed', createFailure: failure })
  );
}
