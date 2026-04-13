// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import type { ApiClient } from '@kinvolk/headlamp-plugin/lib/lib/k8s/api/v1/factories';
import type { KubeNamespace } from '@kinvolk/headlamp-plugin/lib/lib/k8s/namespace';
import {
  MANAGED_BY_ARM_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
} from '../constants/projectLabels';

/** Checks if the given project is an AKS Desktop project (managed-by: aks-desktop). */
export const isAksProject = ({
  project,
}: {
  project: { namespaces: string[]; clusters: string[] };
}): Promise<boolean> =>
  new Promise<boolean>(resolve => {
    const cancelFn = (K8s.ResourceClasses.Namespace.apiEndpoint as ApiClient<KubeNamespace>).get(
      project.namespaces[0],
      ns => {
        resolve(ns.metadata?.labels?.[PROJECT_MANAGED_BY_LABEL] === PROJECT_MANAGED_BY_VALUE);
        cancelFn.then(it => it());
      },
      () => {
        cancelFn.then(it => it());
        resolve(false);
      },
      {},
      project.clusters[0]
    );
  });

/** Checks if the given project is an AKS Desktop + ARM-managed namespace. */
export const isArmManagedProject = ({
  project,
}: {
  project: { namespaces: string[]; clusters: string[] };
}): Promise<boolean> =>
  new Promise<boolean>(resolve => {
    const cancelFn = (K8s.ResourceClasses.Namespace.apiEndpoint as ApiClient<KubeNamespace>).get(
      project.namespaces[0],
      ns => {
        resolve(
          ns.metadata?.labels?.[PROJECT_MANAGED_BY_LABEL] === PROJECT_MANAGED_BY_VALUE &&
            ns.metadata?.labels?.[MANAGED_BY_ARM_LABEL] === 'true'
        );
        cancelFn.then(it => it());
      },
      () => {
        cancelFn.then(it => it());
        resolve(false);
      },
      {},
      project.clusters[0]
    );
  });
