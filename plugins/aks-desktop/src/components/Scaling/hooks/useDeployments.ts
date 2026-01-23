// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';

export interface DeploymentInfo {
  name: string;
  namespace: string;
  replicas: number;
  availableReplicas: number;
  readyReplicas: number;
}

interface UseDeploymentsResult {
  deployments: DeploymentInfo[];
  selectedDeployment: string;
  loading: boolean;
  error: string | null;
  setSelectedDeployment: (deployment: string) => void;
}

/**
 * Custom hook to fetch and manage Kubernetes deployments for a project
 */
export const useDeployments = (
  namespace: string | undefined,
  cluster: string | undefined
): UseDeploymentsResult => {
  const [selectedDeployment, setSelectedDeployment] = useState<string>('');
  const [deployments, setDeployments] = useState<DeploymentInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // @ts-ignore todo: fix this
  useEffect(() => {
    if (!namespace) return;

    setLoading(true);
    setError(null);

    let cancelFnPromise;

    try {
      // Use Headlamp's K8s API to fetch deployments
      cancelFnPromise = K8s.ResourceClasses.Deployment.apiList(
        deploymentList => {
          const fetchedDeployments = deploymentList
            .filter(deployment => deployment.getNamespace() === namespace)
            .map(deployment => ({
              name: deployment.getName(),
              namespace: deployment.getNamespace(),
              replicas: deployment.spec?.replicas || 0,
              availableReplicas: deployment.status?.availableReplicas || 0,
              readyReplicas: deployment.status?.readyReplicas || 0,
            }));

          setDeployments(fetchedDeployments);

          // Auto-select first deployment if none selected
          setSelectedDeployment(current => {
            if (!current && fetchedDeployments.length > 0) {
              return fetchedDeployments[0].name;
            }
            return current;
          });
          setLoading(false);
        },
        (error: any) => {
          console.error('Error fetching deployments:', error);
          setError('Failed to fetch deployments');
          setDeployments([]);
          setLoading(false);
        },
        {
          namespace,
          cluster,
        }
      )();
    } catch (err) {
      console.error('Error in fetchDeployments:', err);
      setError('Failed to fetch deployments');
      setLoading(false);
      return undefined;
    }

    return () => {
      cancelFnPromise?.then(cancelFn => cancelFn());
    };
  }, [namespace, cluster]);

  return {
    deployments,
    selectedDeployment,
    loading,
    error,
    setSelectedDeployment,
  };
};
