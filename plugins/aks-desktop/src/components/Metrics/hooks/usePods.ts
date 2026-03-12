// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import Deployment from '@kinvolk/headlamp-plugin/lib/lib/k8s/deployment';
import Pod from '@kinvolk/headlamp-plugin/lib/lib/k8s/pod';
import { useEffect, useState } from 'react';

/** Pod information displayed in the pod details table. */
export interface PodInfo {
  name: string;
  status: string;
  /** Formatted CPU usage string **/
  cpuUsage: string;
  /** Formatted memory usage string **/
  memoryUsage: string;
  restarts: number;
}

/** Result returned by {@link usePods}. */
export interface UsePodsResult {
  /** List of pods in the selected deployment. */
  pods: PodInfo[];
  /** Setter exposed to be consumed by {@link usePrometheusMetrics} for per-pod CPU& memory info. */
  setPods: React.Dispatch<React.SetStateAction<PodInfo[]>>;
  /** Total number of pods in the selected deployment. */
  totalPods: number;
  /** Current status of managed project */
  projectStatus: string;
}

/**
 * Fetches pods for the selected deployment
 *
 * @param selectedDeployment - Name of the currently selected deployment.
 * @param namespace - Namespace that the selected deployment resides in.
 * @param cluster - Name of target cluster.
 * @returns List of pods with corresponding information and setters for CPU & memory usage.
 */
export function usePods(
  selectedDeployment: string,
  namespace: string | undefined,
  cluster: string | undefined
): UsePodsResult {
  const [pods, setPods] = useState<PodInfo[]>([]);
  const [totalPods, setTotalPods] = useState(0);
  const [projectStatus, setProjectStatus] = useState('Unknown');

  useEffect(() => {
    if (!namespace || !selectedDeployment) return;

    // Explicit cancel functions to prevent state updates after unmount
    let cancelDeploymentGet: (() => void) | undefined;
    let cancelPodList: (() => void) | undefined;

    (async () => {
      try {
        // First, fetch the Deployment to get its selector
        cancelDeploymentGet = await K8s.ResourceClasses.Deployment.apiGet(
          async (deployment: Deployment) => {
            // Get the selector from the deployment spec
            const selector = deployment.spec?.selector?.matchLabels;
            if (!selector) {
              console.error('MetricsTab: No selector found in deployment spec');
              setPods([]);
              return;
            }

            // Convert selector object to label selector string
            const labelSelector = Object.entries(selector)
              .map(([key, value]) => `${key}=${value}`)
              .join(',');

            // Now use the deployment's selector to find pods
            cancelPodList = await K8s.ResourceClasses.Pod.apiList(
              (podList: Pod[]) => {
                const podData: PodInfo[] = podList.map((p: any) => {
                  const pod = p.jsonData ?? p;
                  const status = pod.status?.phase || 'Unknown';
                  const restarts =
                    pod.status?.containerStatuses?.reduce(
                      (sum: number, cs: any) => sum + (cs.restartCount || 0),
                      0
                    ) || 0;

                  return {
                    name: pod.metadata?.name ?? '',
                    status: status,
                    cpuUsage: 'N/A', // Will be updated from metrics
                    memoryUsage: 'N/A', // Will be updated from metrics
                    restarts: restarts,
                  };
                });

                setPods(podData);
                setTotalPods(podData.length);
                setProjectStatus(
                  podData.length === 0
                    ? 'Unknown'
                    : podData.every(p => p.status === 'Running')
                    ? 'Healthy'
                    : 'Degraded'
                );
              },
              (error: any) => {
                console.error('MetricsTab: Error fetching pods:', error);
              },
              {
                namespace: namespace,
                cluster: cluster,
                queryParams: {
                  labelSelector: labelSelector,
                },
              }
            )();
          },
          selectedDeployment,
          namespace,
          (err: any) => {
            console.error('MetricsTab: Error fetching deployment for pod selector:', err);
          },
          {
            cluster: cluster,
          }
        )();
      } catch (err) {
        console.error('MetricsTab: Error in fetchPods:', err);
      }
    })();

    return () => {
      cancelPodList?.();
      cancelDeploymentGet?.();
    };
  }, [namespace, cluster, selectedDeployment]);

  return { pods, setPods, totalPods, projectStatus };
}
