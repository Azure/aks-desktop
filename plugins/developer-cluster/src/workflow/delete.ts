// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Delete: the check that the cluster the page shows is still the loaded one, a fresh read of the
// target, then the CLI delete by name (teardown needs no Kubernetes version), which removes the
// cluster's WSL instance and then its entries in the user's default kubeconfig, and finally a
// request that AKS Desktop drop the cluster from its list. The confirmation dialog asks first, and
// nothing is retried automatically. AKS Desktop's cluster menu starts the same Delete for its local
// context.

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { deleteCluster } from '../cli/commands';
import { LocalTarget } from '../contract/capability';
import { hostError } from './failure';
import { exclusive } from './guard';
import { refreshOverview, refreshTarget } from './setup';
import { getWorkflowState, update } from './store';

/**
 * Whether two targets are the same cluster.
 *
 * @param left - One target.
 * @param right - The other target.
 * @returns True when the name, Kubernetes version and context name match.
 */
function sameTarget(left: LocalTarget, right: LocalTarget): boolean {
  return (
    left.name === right.name &&
    left.distribution === right.distribution &&
    left.kubernetesVersion === right.kubernetesVersion &&
    left.contextName === right.contextName
  );
}

/**
 * A fresh read must still show the target the user confirmed, unchanged.
 *
 * @param confirmed - The target the user confirmed.
 * @returns A promise of the freshly read target; it rejects with `identity-mismatch` when no target
 * or another target is loaded.
 */
async function readAgain(confirmed: LocalTarget): Promise<Readonly<LocalTarget>> {
  const target = await refreshTarget();
  if (target === null || !sameTarget(target, confirmed)) throw hostError('identity-mismatch');
  return target;
}

/**
 * Deletes the local cluster when the loaded target is still the target `shown`: the same name,
 * Kubernetes version and context. Overview asks for no typed confirmation or consent. Resolves
 * true when the cluster was deleted, and false when Delete was refused or failed (`deleteFailure`).
 * After a failure Overview is refreshed.
 *
 * @param shown - The target the page showed when the user confirmed Delete.
 * @returns A promise of whether the cluster was deleted.
 */
export async function deleteLocalCluster(shown: LocalTarget): Promise<boolean> {
  const confirmed = getWorkflowState().target;
  if (confirmed === null || !sameTarget(confirmed, shown)) return false;
  return runDelete(() => readAgain(confirmed));
}

/**
 * Overview's Delete for the context selected in AKS Desktop's cluster menu. The page
 * may not have read the target in this session, so a fresh read supplies it, and it must
 * be the selected context and the cluster the dialog named; otherwise `identity-mismatch`.
 * Resolves as deleteLocalCluster does.
 *
 * @param contextName - The kubeconfig context selected in the cluster menu.
 * @param clusterName - The cluster name the dialog showed.
 * @returns A promise of whether the cluster was deleted.
 */
export function deleteLocalContext(contextName: string, clusterName: string): Promise<boolean> {
  return runDelete(async () => {
    const target = await refreshTarget();
    if (target === null || target.contextName !== contextName || target.name !== clusterName) {
      throw hostError('identity-mismatch');
    }
    return target;
  });
}

/** How long Delete waits for AKS Desktop's backend to drop the deleted cluster from its list. */
const FORGET_TIMEOUT_MS = 10_000;

/**
 * Asks AKS Desktop's backend to drop the deleted cluster from its cluster list, without touching
 * any file. Its kubeconfig watcher can miss a removal written by an atomic file replacement and
 * keep listing the deleted cluster; the Home list follows at its next refresh. The request goes
 * straight to the backend's `DELETE /cluster/{name}`: `ApiProxy.deleteCluster` would first delete a
 * browser-stored kubeconfig of the same name and reload the window. A failure does not fail Delete:
 * the cluster is already gone.
 *
 * @param listName - The name AKS Desktop lists the cluster under.
 */
async function forgetCluster(listName: string): Promise<void> {
  try {
    await ApiProxy.request(
      `/cluster/${encodeURIComponent(listName)}`,
      { method: 'DELETE', timeout: FORGET_TIMEOUT_MS },
      false,
      false
    );
  } catch (error) {
    console.warn(
      'Developer Cluster: could not remove the deleted context from the cluster list',
      error
    );
  }
}

/**
 * Runs Delete for the target `resolve` returns. The running phase is set before the first wait, so
 * a page opened right after the call shows the progress.
 *
 * @param resolve - Reads the target to delete and checks it; a rejection fails Delete.
 * @returns A promise of whether the cluster was deleted.
 */
async function runDelete(resolve: () => Promise<Readonly<LocalTarget>>): Promise<boolean> {
  const run = { failed: false };
  const deleted = await exclusive(
    async () => {
      // Delete changes this computer, so a later Setup needs the environment step's checks again.
      update({
        deletePhase: 'running',
        deleteFailure: null,
        createPhase: 'idle',
        createFailure: null,
        environment: null,
      });
      const target = await resolve();
      await deleteCluster(target.name);
      await forgetCluster(target.listName);
      update({
        deletePhase: 'deleted',
        overviewInitialized: true,
        target: null,
      });
    },
    failure => {
      run.failed = true;
      return { deletePhase: 'failed', deleteFailure: failure };
    }
  );
  if (run.failed) await refreshOverview();
  return deleted;
}
