// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { clusterRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { useState } from 'react';
import type { DeploymentInfo } from './useDeployments';
import type { HPAInfo } from './useHPAInfo';

// Headers for Kubernetes PATCH requests (merge patch)
const MERGE_PATCH_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/merge-patch+json',
};

/**
 * Form values for the scaling edit dialog.
 */
export interface EditValues {
  /** Minimum replicas for HPA mode. */
  minReplicas: number;
  /** Maximum replicas for HPA mode. */
  maxReplicas: number;
  /** Target CPU utilization percentage for HPA mode. */
  targetCPU: number;
  /** Desired replica count for manual mode. */
  replicas: number;
}

/**
 * Return type for the {@link useEditDialog} hook.
 */
interface UseEditDialogResult {
  /** Whether the edit dialog is open. */
  editDialogOpen: boolean;
  /** Current form values. */
  editValues: EditValues;
  /** Whether a save request is in flight. */
  saving: boolean;
  /** Error message from the last failed save, or null. */
  saveError: string | null;
  /** Opens the dialog, pre-populating form values from the current deployment/HPA state. */
  handleEditClick: () => void;
  /** Closes the dialog without saving. */
  handleClose: () => void;
  /** Updates the form values. */
  setEditValues: React.Dispatch<React.SetStateAction<EditValues>>;
  /** Persists the current form values to Kubernetes via PATCH. */
  handleSave: () => Promise<void>;
}

/**
 * Manages dialog open state, form values, and save logic for the scaling edit dialog.
 *
 * In HPA mode, patches the HPA resource (minReplicas, maxReplicas, targetCPU).
 * In manual mode, patches the deployment's replica count.
 *
 * @param selectedDeployment - The currently selected deployment name.
 * @param deployments - Full list of deployments (used to look up current replica counts).
 * @param hpaInfo - Current HPA state, or null if the deployment is not HPA-managed.
 * @param namespace - The Kubernetes namespace.
 * @param cluster - The cluster identifier.
 * @param onSaved - Called after a successful save.
 */
export const useEditDialog = (
  selectedDeployment: string,
  deployments: DeploymentInfo[],
  hpaInfo: HPAInfo | null,
  namespace: string | undefined,
  cluster: string | undefined,
  onSaved: () => void
): UseEditDialogResult => {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editValues, setEditValues] = useState<EditValues>({
    minReplicas: 1,
    maxReplicas: 10,
    targetCPU: 50,
    replicas: 1,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleEditClick = () => {
    const currentDeployment = deployments.find(d => d.name === selectedDeployment);
    setEditValues({
      minReplicas: hpaInfo?.minReplicas ?? 1,
      maxReplicas: hpaInfo?.maxReplicas ?? 10,
      targetCPU: hpaInfo?.targetCPUUtilization ?? 50,
      replicas: currentDeployment?.replicas ?? 1,
    });
    setEditDialogOpen(true);
  };

  const handleClose = () => {
    setEditDialogOpen(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!namespace || !cluster || !selectedDeployment) {
      setSaveError('Cannot save: missing namespace, cluster, or deployment');
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      if (hpaInfo) {
        const hpaPatchData = {
          spec: {
            minReplicas: editValues.minReplicas,
            maxReplicas: editValues.maxReplicas,
            targetCPUUtilizationPercentage: editValues.targetCPU,
          },
        };

        await clusterRequest(
          `/apis/autoscaling/v2/namespaces/${namespace}/horizontalpodautoscalers/${hpaInfo.name}`,
          {
            method: 'PATCH',
            body: JSON.stringify(hpaPatchData),
            headers: MERGE_PATCH_HEADERS,
            cluster,
          }
        );
      } else {
        const deploymentPatchData = {
          spec: {
            replicas: editValues.replicas,
          },
        };

        await clusterRequest(
          `/apis/apps/v1/namespaces/${namespace}/deployments/${selectedDeployment}`,
          {
            method: 'PATCH',
            body: JSON.stringify(deploymentPatchData),
            headers: MERGE_PATCH_HEADERS,
            cluster,
          }
        );
      }

      setEditDialogOpen(false);
      onSaved();
    } catch (error) {
      console.error('Error saving scaling configuration:', error);
      setSaveError(
        `Failed to save scaling configuration: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      setSaving(false);
    }
  };

  return {
    editDialogOpen,
    editValues,
    saving,
    saveError,
    handleEditClick,
    handleClose,
    setEditValues,
    handleSave,
  };
};
