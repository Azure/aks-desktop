// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';

export interface DeploymentStatus {
  name: string;
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
}

export interface PodStatus {
  name: string;
  phase: string;
  restarts: number;
}

export interface ServiceStatus {
  name: string;
  type: string;
  clusterIP: string;
  externalIP: string | null;
}

export interface ClusterDeployStatus {
  deployments: DeploymentStatus[];
  pods: PodStatus[];
  services: ServiceStatus[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches comprehensive deployment, pod, and service status for a single cluster+namespace.
 */
export const useClusterDeployStatus = (
  cluster: string,
  namespace: string,
  enabled: boolean
): ClusterDeployStatus => {
  const [deployments, setDeployments] = useState<DeploymentStatus[]>([]);
  const [pods, setPods] = useState<PodStatus[]>([]);
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !namespace || !cluster) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    // apiList()() may return a Promise<CancelFunction> — collect as promises
    // and resolve them in the cleanup function.
    const cancelPromises: Array<Promise<any>> = [];

    try {
      // Fetch deployments
      const cancelDeploys = K8s.ResourceClasses.Deployment.apiList(
        list => {
          setDeployments(
            list
              .filter(d => d.getNamespace() === namespace)
              .map(d => ({
                name: d.getName(),
                replicas: d.spec?.replicas || 0,
                readyReplicas: d.status?.readyReplicas || 0,
                availableReplicas: d.status?.availableReplicas || 0,
              }))
          );
          setLoading(false);
        },
        () => {
          setError('Failed to fetch deployments');
          setLoading(false);
        },
        { namespace, cluster }
      )();
      cancelPromises.push(Promise.resolve(cancelDeploys));

      // Fetch pods
      const cancelPods = K8s.ResourceClasses.Pod.apiList(
        list => {
          setPods(
            list
              .filter(p => p.getNamespace() === namespace)
              .map(p => ({
                name: p.getName(),
                phase: p.status?.phase || 'Unknown',
                restarts:
                  p.status?.containerStatuses?.reduce(
                    (sum: number, cs: any) => sum + (cs.restartCount || 0),
                    0
                  ) ?? 0,
              }))
          );
        },
        () => {
          /* ignore pod errors — deployments is primary */
        },
        { namespace, cluster }
      )();
      cancelPromises.push(Promise.resolve(cancelPods));

      // Fetch services
      const cancelSvcs = K8s.ResourceClasses.Service.apiList(
        list => {
          setServices(
            list
              .filter(s => s.getNamespace() === namespace)
              .map(s => ({
                name: s.getName(),
                type: s.spec?.type || 'ClusterIP',
                clusterIP: s.spec?.clusterIP || '',
                externalIP:
                  s.status?.loadBalancer?.ingress?.[0]?.ip ??
                  s.status?.loadBalancer?.ingress?.[0]?.hostname ??
                  null,
              }))
          );
        },
        () => {
          /* ignore service errors */
        },
        { namespace, cluster }
      )();
      cancelPromises.push(Promise.resolve(cancelSvcs));
    } catch (err) {
      setError('Failed to fetch cluster status');
      setLoading(false);
    }

    return () => {
      cancelPromises.forEach(p => {
        p.then((fn: any) => typeof fn === 'function' && fn()).catch(() => {});
      });
    };
  }, [cluster, namespace, enabled]);

  return { deployments, pods, services, loading, error };
};
