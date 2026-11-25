// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// When the UI offers an action. The gates keep a button disabled; the workflow still refuses a busy
// state and invalid Create inputs, because AKS Desktop's cluster-menu Delete and a click before the
// page redraws bypass the buttons.

import { KubernetesVersionOption } from '../cli/commands';
import { ConsentKind } from '../contract/capability';
import { isClusterName } from '../contract/clusterName';
import { isKubernetesDistribution } from '../contract/devctl';
import { consentKind, environmentBlockers } from '../workflow/environment';
import { WorkflowState } from '../workflow/store';
import { SetupDraft } from './setupDraft';

/** A Setup page: the environment checks, the configuration, the review and the running Create. */
export type SetupStep = 'environment' | 'configure' | 'review' | 'create';

/**
 * Refreshes and Check again: refused while another operation runs.
 *
 * @param state - The workflow state.
 * @returns True when no operation is running.
 */
export function canRefresh(state: WorkflowState): boolean {
  return !state.busy;
}

/**
 * A catalog entry with this version exists and is not deprecated.
 *
 * @param versions - The CLI catalog.
 * @param version - The catalog `version` to look up.
 * @returns True when an entry has this version and is not deprecated.
 */
export function versionAvailable(
  versions: readonly KubernetesVersionOption[],
  version: string
): boolean {
  return versions.some(entry => entry.version === version && !entry.deprecated);
}

/**
 * The inputs Create accepts, also checked by Create: a valid name and an available version.
 *
 * @param draft - The cluster name and the selected catalog `version`.
 * @param state - The workflow state, which holds the catalog.
 * @returns True for a valid name and an available version; false before the catalog is read.
 */
export function configurationValid(
  draft: Pick<SetupDraft, 'name' | 'distribution' | 'kubernetesVersion'>,
  state: WorkflowState
): boolean {
  const { kubernetesVersion } = draft;
  return (
    isClusterName(draft.name) &&
    isKubernetesDistribution(draft.distribution) &&
    kubernetesVersion !== null &&
    state.versions !== null &&
    versionAvailable(state.versions, kubernetesVersion)
  );
}

/**
 * The consent kind a clean inspection, platform check included, allows; else null.
 *
 * @param state - The workflow state with the environment step's last result.
 * @returns `install` when the last checks succeeded and nothing blocks Next; otherwise null.
 */
export function currentConsent(state: WorkflowState): ConsentKind | null {
  const { environment } = state;
  if (environment === null || state.refreshFailure !== null) return null;
  return environmentBlockers(environment).length === 0 ? consentKind(environment) : null;
}

/**
 * Next in the environment step: the ticked consent matches a clean inspection.
 *
 * @param state - The workflow state.
 * @param agreed - The consent the user ticked, or null.
 * @returns True when the ticked consent is the current consent, no operation runs, the catalog is
 * read and no local cluster is registered.
 */
export function environmentNextAllowed(state: WorkflowState, agreed: ConsentKind | null): boolean {
  return (
    agreed !== null &&
    agreed === currentConsent(state) &&
    canRefresh(state) &&
    state.versions !== null &&
    state.target === null
  );
}

/**
 * Create Cluster in Review: the accepted consent still applies and the inputs are valid.
 *
 * @param draft - The Setup draft with the accepted consent and the inputs.
 * @param state - The workflow state.
 * @returns True when the accepted consent is the current consent, no operation runs, no local
 * cluster is registered and the inputs are valid.
 */
export function canCreate(draft: SetupDraft, state: WorkflowState): boolean {
  return (
    draft.consent !== null &&
    draft.consent === currentConsent(state) &&
    canRefresh(state) &&
    state.target === null &&
    configurationValid(draft, state)
  );
}

/**
 * Delete Cluster: a local cluster and no other operation.
 *
 * @param state - The workflow state.
 * @returns True when a local cluster is registered and no operation runs.
 */
export function canDelete(state: WorkflowState): boolean {
  return canRefresh(state) && state.target !== null;
}

/**
 * Check again after Create: Headlamp had not loaded the new context in time.
 *
 * @param state - The workflow state.
 * @returns True when readiness is `not-confirmed` and no operation runs.
 */
export function canCheckReadiness(state: WorkflowState): boolean {
  return canRefresh(state) && state.createPhase === 'not-confirmed';
}

/**
 * Open cluster: readiness reported `usable` in this session.
 *
 * @param state - The workflow state.
 * @returns True when a local cluster is registered and readiness is `usable`.
 */
export function canOpenCluster(state: WorkflowState): boolean {
  return state.target !== null && state.createPhase === 'usable';
}

/**
 * Whether a Setup step may render. Setup inputs live in memory, so a reload or a direct link to a
 * later step returns to the environment step.
 *
 * @param step - The step to render.
 * @param draft - The Setup draft.
 * @param state - The workflow state.
 * @returns True for `environment`; for `configure` once consent is accepted and the catalog read;
 * for `review` once the configure step was completed with valid inputs; for `create` while the
 * Create phase is not `idle`.
 */
export function setupStepAllowed(
  step: SetupStep,
  draft: SetupDraft,
  state: WorkflowState
): boolean {
  switch (step) {
    case 'environment':
      return true;
    case 'configure':
      return draft.consent !== null && state.versions !== null;
    case 'review':
      return (
        setupStepAllowed('configure', draft, state) &&
        draft.configured &&
        configurationValid(draft, state)
      );
    case 'create':
      return state.createPhase !== 'idle';
  }
}
