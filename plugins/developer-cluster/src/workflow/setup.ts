// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Read-only refreshes for Overview and Setup. The target is the Developer Cluster context Headlamp
// loaded from the kubeconfig. Only Setup's environment step runs the platform check and the WSL
// queries: once per Setup attempt, and again when the user selects Check again. Overview reads only
// the target.

import { KubernetesVersionOption, listKubernetesVersions } from '../cli/commands';
import { startSetup } from '../common/setupDraft';
import { LocalTarget } from '../contract/capability';
import { readLocalTarget } from '../native/localContext';
import { inspectWsl } from '../native/platformChecks';
import { WorkflowFailure } from './failure';
import { exclusive } from './guard';
import { checkPlatform } from './platform';
import { freezeEnvironment, freezeTarget, update, WorkflowState } from './store';

/** Reads and records the target, without the WSL queries. */
export async function refreshTarget(): Promise<Readonly<LocalTarget> | null> {
  const found = await readLocalTarget();
  const target = found === null ? null : freezeTarget(found);
  update({ target });
  return target;
}

function refreshFailed(failure: WorkflowFailure): Partial<WorkflowState> {
  return { refreshFailure: failure };
}

/** Refreshes Overview; resolves false when refused or failed (`refreshFailure`). */
export async function refreshOverview(): Promise<boolean> {
  return exclusive(async () => {
    try {
      update({ refreshFailure: null });
      await refreshTarget();
    } finally {
      // Only an executed refresh initializes Overview. A remount refused by exclusive() must keep
      // showing discovery progress until the already-running refresh settles.
      update({ overviewInitialized: true });
    }
  }, refreshFailed);
}

/**
 * Starts a Setup attempt from Overview: the initial inputs, and no environment result or catalog,
 * so the environment step checks this computer once.
 */
export function beginSetup(): void {
  startSetup();
  update({ environment: null, versions: null, refreshFailure: null });
}

/**
 * The environment step's checks, also its Check again; resolves false when refused or failed. The
 * result and the catalog are recorded together, only when every check succeeded. A failure also
 * discards the previous result, so a result always comes from the latest checks.
 */
export function refreshSetup(): Promise<boolean> {
  return exclusive(
    async () => {
      update({ refreshFailure: null });
      await checkPlatform();
      const [target, wsl] = await Promise.all([readLocalTarget(), inspectWsl()]);
      const versions = await listKubernetesVersions();
      const environment = freezeEnvironment({ target, ...wsl });
      update({ environment, target: environment.target, versions });
    },
    failure => ({ refreshFailure: failure, environment: null })
  );
}

/** The preselected version: the first entry that is not deprecated. */
export function defaultKubernetesVersion(
  versions: readonly KubernetesVersionOption[]
): string | null {
  const option = versions.find(entry => !entry.deprecated);
  return option === undefined ? null : option.version;
}
