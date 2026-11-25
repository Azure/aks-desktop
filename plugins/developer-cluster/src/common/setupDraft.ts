// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Setup inputs. They live in memory only: a reload starts from the initial draft, and a direct link
// to a later step returns to the environment step. Nothing here changes the computer; Create reads
// the draft when the user selects Create Cluster.

import { ConsentKind } from '../contract/capability';
import { DEFAULT_CLUSTER_NAME } from '../contract/clusterName';
import { KubernetesDistribution } from '../contract/devctl';

/** The Setup inputs, kept in memory. */
export interface SetupDraft {
  /** The consent the user ticked in the environment step; null until then. */
  readonly consent: ConsentKind | null;
  /** The cluster name; DEFAULT_CLUSTER_NAME until the configure step records another. */
  readonly name: string;
  readonly distribution: KubernetesDistribution;
  /** The selected catalog entry's `version`; null until the configure step. */
  readonly kubernetesVersion: string | null;
  /** The compute type: true for NVIDIA GPU support, false for a standard cluster. */
  readonly gpu: boolean;
  /** The configure step was completed with the name and version above. */
  readonly configured: boolean;
}

const INITIAL: SetupDraft = Object.freeze({
  consent: null,
  name: DEFAULT_CLUSTER_NAME,
  distribution: 'K8s',
  kubernetesVersion: null,
  gpu: false,
  configured: false,
});

/** One registered listener. */
interface Subscription {
  /** Called after every change of the draft. */
  readonly listener: () => void;
}

let draft: SetupDraft = INITIAL;
let subscriptions: readonly Subscription[] = [];

/**
 * The current draft, for `useSyncExternalStore`.
 *
 * @returns The frozen draft; a new object after every change.
 */
export function getSetupDraft(): SetupDraft {
  return draft;
}

/**
 * Calls `listener` after every change; the returned function unsubscribes, at most once.
 *
 * @param listener - Called without arguments after every change.
 * @returns A function that removes this listener.
 */
export function subscribeSetupDraft(listener: () => void): () => void {
  const subscription: Subscription = { listener };
  subscriptions = subscriptions.concat(subscription);
  return () => {
    subscriptions = subscriptions.filter(item => item !== subscription);
  };
}

/**
 * Replaces the draft with a frozen copy that includes `patch`, then calls every listener.
 *
 * @param patch - The inputs to change.
 */
function change(patch: Partial<SetupDraft>): void {
  draft = Object.freeze({ ...draft, ...patch });
  for (const subscription of subscriptions) subscription.listener();
}

/** Starts Setup from Overview with the initial inputs. */
export function startSetup(): void {
  change(INITIAL);
}

/**
 * Records the consent the user ticked for the inspected kind.
 *
 * @param kind - The consent kind the user ticked.
 */
export function acceptEnvironment(kind: ConsentKind): void {
  change({ consent: kind });
}

/** Withdraws the consent: the user cleared it, or AKS Desktop asked for it again. */
export function withdrawConsent(): void {
  change({ consent: null });
}

/**
 * Records the configure step's inputs; the caller has validated them.
 *
 * @param settings - The choices confirmed on Configure.
 */
export function configureCluster(
  settings: Pick<SetupDraft, 'name' | 'distribution' | 'gpu'> & { kubernetesVersion: string }
): void {
  change({ ...settings, configured: true });
}
