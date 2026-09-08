// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { type KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';
import { useEffect, useMemo, useState } from 'react';

/**
 * Return type for the {@link useLogsTab} hook.
 */
export interface UseLogsTabResult {
  /** Deployments filtered from the provided project resources. */
  deployments: KubeObject[];
  /** The currently selected deployment, or undefined if none. */
  selectedDeployment: KubeObject | undefined;
  /** Name of the currently selected deployment, or an empty string if none is available. */
  selectedDeploymentName: string;
  /**
   * Deferred flag that starts false so the live region mounts with empty text,
   * then flips to true after the first paint so empty-state text changes are announced.
   */
  liveReady: boolean;
  /** Updates the selected deployment by name. */
  setSelectedDeploymentName: (name: string) => void;
}

/**
 * Manages deployment filtering and selection state for the LogsTab component.
 *
 * Filters Deployments from the provided project resources and auto-selects the first
 * one when none is selected. Also manages the deferred live-region flag used to
 * announce the empty state to screen readers without a false announcement on mount.
 *
 * @param projectResources - All Kubernetes resources for the project; Deployments are extracted internally.
 * @returns Filtered deployments, the resolved selected deployment object, selection state, and a setter.
 */
export const useLogsTab = (projectResources: KubeObject[]): UseLogsTabResult => {
  const deployments = useMemo(
    () => projectResources.filter(it => it.kind === 'Deployment'),
    [projectResources]
  );

  const [selectedDeploymentName, setSelectedDeploymentName] = useState<string>('');
  const [liveReady, setLiveReady] = useState(false);

  useEffect(() => {
    setLiveReady(true);
  }, []);

  // Auto-select first deployment when none is selected or the selected name no longer exists
  useEffect(() => {
    if (deployments.length === 0) return;
    const stillExists = deployments.some(d => d.jsonData.metadata.name === selectedDeploymentName);
    if (!stillExists) {
      setSelectedDeploymentName(deployments[0].jsonData.metadata.name as string);
    }
  }, [deployments, selectedDeploymentName]);

  const selectedDeployment = useMemo(
    () => deployments.find(it => it.jsonData.metadata.name === selectedDeploymentName),
    [deployments, selectedDeploymentName]
  );

  return {
    deployments,
    selectedDeployment,
    selectedDeploymentName,
    liveReady,
    setSelectedDeploymentName,
  };
};
