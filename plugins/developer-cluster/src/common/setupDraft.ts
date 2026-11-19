// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Setup inputs. They live in memory only: a reload starts from the initial draft, and a direct link
// to a later step returns to the environment step. Nothing here changes the computer; Create reads
// the draft when the user selects Create Cluster.

import { ConsentKind } from '../contract/capability';
import { DEFAULT_CLUSTER_NAME } from '../contract/clusterName';

export interface SetupDraft {
  /** The consent the user ticked in the environment step; null until then. */
  readonly consent: ConsentKind | null;
  readonly name: string;
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
  kubernetesVersion: null,
  gpu: false,
  configured: false,
});

interface Subscription {
  readonly listener: () => void;
}

let draft: SetupDraft = INITIAL;
let subscriptions: readonly Subscription[] = [];

/** The current draft, for `useSyncExternalStore`. */
export function getSetupDraft(): SetupDraft {
  return draft;
}

/** Calls `listener` after every change; the returned function unsubscribes, at most once. */
export function subscribeSetupDraft(listener: () => void): () => void {
  const subscription: Subscription = { listener };
  subscriptions = subscriptions.concat(subscription);
  return () => {
    subscriptions = subscriptions.filter(item => item !== subscription);
  };
}

function change(patch: Partial<SetupDraft>): void {
  draft = Object.freeze({ ...draft, ...patch });
  for (const subscription of subscriptions) subscription.listener();
}

/** Starts Setup from Overview with the initial inputs. */
export function startSetup(): void {
  change(INITIAL);
}

/** Records the consent the user ticked for the inspected kind. */
export function acceptEnvironment(kind: ConsentKind): void {
  change({ consent: kind });
}

/** Withdraws the consent: the user cleared it, or AKS Desktop asked for it again. */
export function withdrawConsent(): void {
  change({ consent: null });
}

/** Records the configure step's inputs; the caller has validated them. */
export function configureCluster(name: string, kubernetesVersion: string, gpu: boolean): void {
  change({ name, kubernetesVersion, gpu, configured: true });
}
