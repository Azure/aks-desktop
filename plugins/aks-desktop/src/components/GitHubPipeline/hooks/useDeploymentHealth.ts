// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';

/** Sanitizes a value for use in a Kubernetes label selector. */
function sanitizeLabelValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 63);
}

/** Minimal shape of a K8s Pod resource as accessed by this hook. */
interface PodResource {
  metadata?: { name?: string };
  status?: {
    phase?: string;
    containerStatuses?: Array<{
      restartCount?: number;
      state?: {
        waiting?: { reason?: string };
        terminated?: { reason?: string };
      };
    }>;
  };
  getName?: () => string;
}

/** Minimal shape of a K8s Service resource as accessed by this hook. */
interface ServiceResource {
  metadata?: { name?: string };
  spec?: {
    type?: string;
    clusterIP?: string;
    selector?: Record<string, string>;
  };
  status?: {
    loadBalancer?: {
      ingress?: Array<{ ip?: string; hostname?: string }>;
    };
  };
  getName?: () => string;
}

export interface UseDeploymentHealthResult {
  /** Ready when availableReplicas >= replicas. */
  deploymentReady: boolean;
  podStatuses: Array<{ name: string; status: string; restarts: number }>;
  serviceEndpoint: string | null;
  error: string | null;
}

/**
 * Derives a human-readable pod status from the pod's status fields.
 * Checks containerStatuses for waiting reasons (e.g. CrashLoopBackOff)
 * before falling back to the phase.
 */
const getPodStatus = (pod: PodResource): string => {
  const containerStatuses = pod.status?.containerStatuses;
  if (containerStatuses && containerStatuses.length > 0) {
    for (const cs of containerStatuses) {
      if (cs.state?.waiting?.reason) {
        return cs.state.waiting.reason;
      }
      if (cs.state?.terminated?.reason) {
        return cs.state.terminated.reason;
      }
    }
  }
  return pod.status?.phase || 'Unknown';
};

/**
 * Sums restart counts across all containers in a pod.
 */
const getPodRestarts = (pod: PodResource): number => {
  return (
    pod.status?.containerStatuses?.reduce(
      (sum: number, cs: { restartCount?: number }) => sum + (cs.restartCount ?? 0),
      0
    ) ?? 0
  );
};

/**
 * Extracts the service endpoint from a K8s Service resource.
 * Returns external IP for LoadBalancer, ClusterIP otherwise.
 */
const getServiceEndpoint = (service: ServiceResource): string | null => {
  const spec = service.spec;
  if (!spec) return null;

  if (spec.type === 'LoadBalancer') {
    const ingress = service.status?.loadBalancer?.ingress;
    if (ingress && ingress.length > 0) {
      return ingress[0].ip || ingress[0].hostname || null;
    }
    return null;
  }

  return spec.clusterIP || null;
};

/**
 * Monitors K8s deployment health, pod statuses, and service endpoint.
 * Uses Headlamp's K8s.ResourceClasses API with streaming callbacks.
 *
 * @param appName - Application name used for label selector (`app={appName}`).
 * @param namespace - K8s namespace.
 * @param cluster - Cluster name.
 * @param enabled - Master toggle; set false to disable monitoring.
 */
export const useDeploymentHealth = (
  appName: string,
  namespace: string,
  cluster: string,
  enabled: boolean
): UseDeploymentHealthResult => {
  const { t } = useTranslation();
  const [deploymentReady, setDeploymentReady] = useState(false);
  const [podStatuses, setPodStatuses] = useState<
    Array<{ name: string; status: string; restarts: number }>
  >([]);
  const [serviceEndpoint, setServiceEndpoint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appName || !namespace || !cluster || !enabled) {
      setDeploymentReady(false);
      setPodStatuses([]);
      setServiceEndpoint(null);
      setError(null);
      return;
    }

    let isCancelled = false;
    const cancelFns: Array<() => void> = [];
    setError(null);

    const setup = async () => {
      try {
        const cancelDeployments = await K8s.ResourceClasses.Deployment.apiList(
          deploymentList => {
            if (isCancelled) return;
            const deployment = deploymentList.find(
              d => d.getNamespace() === namespace && d.getName() === appName
            );
            if (deployment) {
              const replicas = deployment.spec?.replicas ?? 0;
              const available = deployment.status?.availableReplicas ?? 0;
              setDeploymentReady(replicas > 0 && available >= replicas);
            } else {
              setDeploymentReady(false);
            }
          },
          (err: unknown) => {
            console.error('Deployment health: error fetching deployments:', err);
            if (!isCancelled) setError(t('Failed to fetch deployment status'));
          },
          { namespace, cluster }
        )();
        cancelFns.push(cancelDeployments);
        if (isCancelled) {
          cancelDeployments();
          return;
        }

        const cancelPods = await K8s.ResourceClasses.Pod.apiList(
          (podList: unknown[]) => {
            if (isCancelled) return;
            const statuses = (podList as PodResource[]).map(pod => ({
              name: pod.metadata?.name || pod.getName?.() || 'unknown',
              status: getPodStatus(pod),
              restarts: getPodRestarts(pod),
            }));
            setPodStatuses(statuses);
          },
          (err: unknown) => {
            console.error('Deployment health: error fetching pods:', err);
            if (!isCancelled) setError(t('Failed to fetch pod status'));
          },
          {
            namespace,
            cluster,
            queryParams: {
              labelSelector: `app=${sanitizeLabelValue(appName)}`,
            },
          }
        )();
        cancelFns.push(cancelPods);
        if (isCancelled) {
          cancelPods();
          return;
        }

        const cancelServices = await K8s.ResourceClasses.Service.apiList(
          (serviceList: unknown[]) => {
            if (isCancelled) return;
            const service = (serviceList as ServiceResource[]).find(svc => {
              const name = svc.metadata?.name || svc.getName?.() || '';
              const selector = svc.spec?.selector;
              return name === appName || (selector && selector.app === appName);
            });
            if (service) {
              setServiceEndpoint(getServiceEndpoint(service));
            } else {
              setServiceEndpoint(null);
            }
          },
          (err: unknown) => {
            console.error('Deployment health: error fetching services:', err);
            if (!isCancelled) setError(t('Failed to fetch service status'));
          },
          { namespace, cluster }
        )();
        cancelFns.push(cancelServices);
        if (isCancelled) {
          cancelServices();
          return;
        }
      } catch (err) {
        console.error('Deployment health: error setting up watchers:', err);
        if (!isCancelled) setError(t('Failed to monitor deployment health'));
      }
    };

    setup();

    return () => {
      isCancelled = true;
      cancelFns.forEach(fn => fn());
    };
  }, [appName, namespace, cluster, enabled]);

  return { deploymentReady, podStatuses, serviceEndpoint, error };
};
