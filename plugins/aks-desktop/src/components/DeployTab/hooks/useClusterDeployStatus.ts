// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';

export const ANNOTATION_DEPLOYED_BY = 'aks-project/deployed-by';
export const ANNOTATION_PIPELINE_REPO = 'aks-project/pipeline-repo';
export const ANNOTATION_PIPELINE_RUN_URL = 'aks-project/pipeline-run-url';

export type DeploymentProvenance = 'manual' | 'pipeline' | 'unknown';

export interface DeploymentStatus {
  name: string;
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  provenance: DeploymentProvenance;
  pipelineRepo: string | null;
  pipelineRunUrl: string | null;
  rawDeployment?: unknown;
}

export interface ServiceStatus {
  name: string;
  type: string;
  clusterIP: string;
  externalIP: string | null;
  rawService?: unknown;
}

export interface ClusterDeployStatus {
  deployments: DeploymentStatus[];
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
  const { t } = useTranslation();
  const [deployments, setDeployments] = useState<DeploymentStatus[]>([]);
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

    let isCancelled = false;
    const cancelFns: Array<() => void> = [];

    // Headlamp's apiList()() returns a cancel function at runtime, though typed as
    // Promise<CancelFunction>. Collect them and call in cleanup.
    const setup = async () => {
      try {
        const cancelDeploys = await K8s.ResourceClasses.Deployment.apiList(
          list => {
            if (isCancelled) return;
            setDeployments(
              list
                .filter(d => d.getNamespace() === namespace)
                .map(d => {
                  const annotations = d.jsonData?.metadata?.annotations ?? {};
                  const deployedBy = annotations[ANNOTATION_DEPLOYED_BY];
                  return {
                    name: d.getName(),
                    replicas: d.spec?.replicas ?? 0,
                    readyReplicas: d.status?.readyReplicas ?? 0,
                    availableReplicas: d.status?.availableReplicas ?? 0,
                    provenance: (deployedBy === 'manual'
                      ? 'manual'
                      : deployedBy === 'pipeline'
                      ? 'pipeline'
                      : 'unknown') as DeploymentProvenance,
                    pipelineRepo: annotations[ANNOTATION_PIPELINE_REPO] ?? null,
                    pipelineRunUrl: annotations[ANNOTATION_PIPELINE_RUN_URL] ?? null,
                    rawDeployment: d.jsonData,
                  };
                })
            );
            setLoading(false);
          },
          (err: unknown) => {
            console.error('Cluster deploy status: error fetching deployments:', err);
            if (!isCancelled) {
              setError(t('Failed to fetch deployments'));
              setLoading(false);
            }
          },
          { namespace, cluster }
        )();
        cancelFns.push(cancelDeploys);
        if (isCancelled) {
          cancelDeploys();
          return;
        }

        const cancelSvcs = await K8s.ResourceClasses.Service.apiList(
          list => {
            if (isCancelled) return;
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
                  rawService: s.jsonData,
                }))
            );
          },
          (err: unknown) => {
            console.warn('Cluster deploy status: non-critical service fetch error:', err);
          },
          { namespace, cluster }
        )();
        cancelFns.push(cancelSvcs);
        if (isCancelled) {
          cancelSvcs();
          return;
        }
      } catch (err) {
        console.error('Cluster deploy status: error setting up watchers:', err);
        if (!isCancelled) {
          setError(t('Failed to fetch cluster status'));
          setLoading(false);
        }
      }
    };

    setup();

    return () => {
      isCancelled = true;
      cancelFns.forEach(fn => fn());
    };
  }, [cluster, namespace, enabled]);

  return { deployments, services, loading, error };
};
