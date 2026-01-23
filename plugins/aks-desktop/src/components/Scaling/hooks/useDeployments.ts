// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';

/**
 * Represents a Kubernetes deployment and its replica status.
 */
export interface DeploymentInfo {
  /** Name of the deployment. */
  name: string;
  /** Kubernetes namespace where the deployment resides. */
  namespace: string;
  /** Desired number of replicas. */
  replicas: number;
  /** Number of replicas that have passed availability checks. */
  availableReplicas: number;
  /** Number of replicas that are ready to serve traffic. */
  readyReplicas: number;
}

/**
 * Return type for the {@link useDeployments} hook.
 */
interface UseDeploymentsResult {
  /** List of deployments in the namespace. */
  deployments: DeploymentInfo[];
  /** Currently selected deployment name. */
  selectedDeployment: string;
  /** Whether deployments are being fetched. */
  loading: boolean;
  /** Error message if fetch failed, otherwise null. */
  error: string | null;
  /** Updates the selected deployment. */
  setSelectedDeployment: (deployment: string) => void;
}

/**
 * Fetches and manages Kubernetes deployments for a namespace.
 *
 * @param namespace - The Kubernetes namespace to fetch deployments from.
 * @param cluster - The cluster identifier.
 * @returns Deployment list, selection state, loading/error status, and a setter.
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

    // Use Headlamp's K8s API to fetch deployments
    K8s.ResourceClasses.Deployment.apiList(
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
  }, [namespace, cluster]);

  return {
    deployments,
    selectedDeployment,
    loading,
    error,
    setSelectedDeployment,
  };
};
