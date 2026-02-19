// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';

/**
 * Return type for the {@link useDeploymentHealth} hook.
 */
interface UseDeploymentHealthResult {
  /** Whether the K8s deployment is ready (availableReplicas >= replicas). */
  deploymentReady: boolean;
  /** Status of individual pods. */
  podStatuses: Array<{ name: string; status: string; restarts: number }>;
  /** Service endpoint (external IP or ClusterIP). */
  serviceEndpoint: string | null;
  /** Error message, if any. */
  error: string | null;
}

/**
 * Derives a human-readable pod status from the pod's status fields.
 * Checks containerStatuses for waiting reasons (e.g. CrashLoopBackOff)
 * before falling back to the phase.
 */
const getPodStatus = (pod: any): string => {
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
const getPodRestarts = (pod: any): number => {
  return (
    pod.status?.containerStatuses?.reduce(
      (sum: number, cs: any) => sum + (cs.restartCount || 0),
      0
    ) || 0
  );
};

/**
 * Extracts the service endpoint from a K8s Service resource.
 * Returns external IP for LoadBalancer, ClusterIP otherwise.
 */
const getServiceEndpoint = (service: any): string | null => {
  const spec = service.spec;
  if (!spec) return null;

  if (spec.type === 'LoadBalancer') {
    const ingress = service.status?.loadBalancer?.ingress;
    if (ingress && ingress.length > 0) {
      return ingress[0].ip || ingress[0].hostname || null;
    }
    return '<pending>';
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
  const [deploymentReady, setDeploymentReady] = useState(false);
  const [podStatuses, setPodStatuses] = useState<
    Array<{ name: string; status: string; restarts: number }>
  >([]);
  const [serviceEndpoint, setServiceEndpoint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appName || !namespace || !cluster || !enabled) {
      return;
    }

    let cancelled = false;
    const cancelFns: Array<() => void> = [];
    setError(null);

    const setup = async () => {
      try {
        // Monitor deployments
        const cancelDeployments = await K8s.ResourceClasses.Deployment.apiList(
          deploymentList => {
            if (cancelled) return;
            const deployment = deploymentList.find(
              d => d.getNamespace() === namespace && d.getName() === appName
            );
            if (deployment) {
              const replicas = deployment.spec?.replicas || 0;
              const available = deployment.status?.availableReplicas || 0;
              setDeploymentReady(replicas > 0 && available >= replicas);
            } else {
              setDeploymentReady(false);
            }
          },
          (err: unknown) => {
            console.error('Deployment health: error fetching deployments:', err);
            if (!cancelled) setError('Failed to fetch deployment status');
          },
          { namespace, cluster }
        )();
        cancelFns.push(cancelDeployments);
        if (cancelled) {
          cancelDeployments();
          return;
        }

        // Monitor pods with label selector
        const cancelPods = await K8s.ResourceClasses.Pod.apiList(
          (podList: unknown[]) => {
            if (cancelled) return;
            const statuses = (podList as Array<Record<string, unknown>>).map(pod => ({
              name:
                ((pod.metadata as Record<string, unknown>)?.name as string) ||
                (pod as { getName?: () => string }).getName?.() ||
                'unknown',
              status: getPodStatus(pod),
              restarts: getPodRestarts(pod),
            }));
            setPodStatuses(statuses);
          },
          (err: unknown) => {
            console.error('Deployment health: error fetching pods:', err);
          },
          {
            namespace,
            cluster,
            queryParams: {
              labelSelector: `app=${appName}`,
            },
          }
        )();
        cancelFns.push(cancelPods);
        if (cancelled) {
          cancelPods();
          return;
        }

        // Monitor services
        const cancelServices = await K8s.ResourceClasses.Service.apiList(
          (serviceList: unknown[]) => {
            if (cancelled) return;
            const service = (serviceList as Array<Record<string, unknown>>).find(svc => {
              const name =
                ((svc.metadata as Record<string, unknown>)?.name as string) ||
                (svc as { getName?: () => string }).getName?.() ||
                '';
              const selector = (svc.spec as Record<string, unknown>)?.selector as
                | Record<string, string>
                | undefined;
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
          },
          { namespace, cluster }
        )();
        cancelFns.push(cancelServices);
        if (cancelled) {
          cancelServices();
          return;
        }
      } catch (err) {
        console.error('Deployment health: error setting up watchers:', err);
        if (!cancelled) setError('Failed to monitor deployment health');
      }
    };

    setup();

    return () => {
      cancelled = true;
      cancelFns.forEach(fn => fn());
    };
  }, [appName, namespace, cluster, enabled]);

  return { deploymentReady, podStatuses, serviceEndpoint, error };
};
