// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Deployment from '@kinvolk/headlamp-plugin/lib/lib/k8s/deployment';
import { useEffect, useState } from 'react';

/** Basic deployment information used in deployment selector dropdown. */
export interface DeploymentInfo {
  name: string;
  namespace: string;
}

/** Result returned by {@link useDeployments}. */
export interface UseDeploymentsResult {
  /** List of deployments in the namespace. */
  deployments: DeploymentInfo[];
  /** Currently selected deployment. */
  selectedDeployment: string;
  /** Loading state of the deployments fetch. */
  loading: boolean;
  /** Error state of the deployments fetch. */
  error: string | null;
  /** Function to set the currently selected deployment. */
  setSelectedDeployment: (deployment: string) => void;
}

/**
 * Fetches deployments in the given namespace & manages the selected deployment states.
 *
 * Auto-selects the first deployment when the list loads for the first time.
 *
 * @param namespace - Kubernetes namespace to list deployments from.
 * @param cluster - Cluster context name.
 */
export function useDeployments(
  namespace: string | undefined,
  cluster: string | undefined
): UseDeploymentsResult {
  const { t } = useTranslation();
  const [selectedDeployment, setSelectedDeployment] = useState<string>('');
  const [deployments, setDeployments] = useState<DeploymentInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!namespace) return;

    setLoading(true);
    setError(null);

    // Explicit cancel function to prevent state updates after an unmount
    let cancelFn: (() => void) | undefined;

    try {
      K8s.ResourceClasses.Deployment.apiList(
        (deploymentList: Deployment[]) => {
          const deploymentData = deploymentList.map((d: Deployment) => ({
            name: d.getName(),
            namespace: d.getNamespace(),
          }));

          setDeployments(deploymentData);

          // Auto-select first deployment (If no deployment is currently selected)
          if (deploymentData.length > 0 && !selectedDeployment) {
            setSelectedDeployment(deploymentData[0].name);
          }

          setLoading(false);
        },
        (error: any) => {
          console.error('MetricsTab: Error fetching deployments:', error);
          setDeployments([]);
          setSelectedDeployment('');
          setError(t('Failed to fetch deployments'));
          setLoading(false);
        },
        {
          namespace: namespace,
          cluster: cluster,
        }
      )().then(cancel => {
        cancelFn = cancel;
      });
    } catch (err) {
      console.error('MetricsTab: Error in fetchDeployments:', err);
      setDeployments([]);
      setSelectedDeployment('');
      setError(t('Failed to fetch deployments'));
      setLoading(false);
    }

    return () => {
      cancelFn?.();
    };
  }, [namespace, cluster]);

  return { deployments, selectedDeployment, loading, error, setSelectedDeployment };
}
