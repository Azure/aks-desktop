// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';

/**
 * Represents Horizontal Pod Autoscaler configuration and status.
 */
export interface HPAInfo {
  /** Name of the HPA resource. */
  name: string;
  /** Kubernetes namespace where the HPA is defined. */
  namespace: string;
  /** Minimum number of replicas the HPA can scale down to. */
  minReplicas: number | undefined;
  /** Maximum number of replicas the HPA can scale up to. */
  maxReplicas: number | undefined;
  /** Target average CPU utilization percentage across pods. */
  targetCPUUtilization: number | undefined;
  /** Current average CPU utilization percentage across pods. */
  currentCPUUtilization: number | undefined;
  /** Current number of running replicas. */
  currentReplicas: number | undefined;
  /** Desired number of replicas as determined by the HPA. */
  desiredReplicas: number | undefined;
}

/**
 * Return type for the {@link useHPAInfo} hook.
 */
interface UseHPAInfoResult {
  /** The HPA info for the deployment, or null if no HPA targets it. */
  hpaInfo: HPAInfo | null;
}

/**
 * Fetches HPA information for a given deployment.
 *
 * @param deploymentName - The name of the deployment to find an HPA for.
 * @param namespace - The Kubernetes namespace to search in.
 * @param cluster - The cluster identifier.
 * @returns An object containing the HPA info, or null if none found.
 */
export const useHPAInfo = (
  deploymentName: string | undefined,
  namespace: string | undefined,
  cluster: string | undefined
): UseHPAInfoResult => {
  const [hpaInfo, setHpaInfo] = useState<HPAInfo | null>(null);

  useEffect(() => {
    if (!deploymentName || !namespace) {
      return;
    }

    // Find HPA that targets this deployment
    // @ts-expect-error Headlamp apiList returns a callable runner at runtime.
    const runWatcher = K8s.ResourceClasses.HorizontalPodAutoscaler.apiList(
      hpaList => {
        const hpa = hpaList.find(
          hpa =>
            hpa.getNamespace() === namespace && hpa.spec?.scaleTargetRef?.name === deploymentName
        );
        if (hpa) {
          // Parse HPA CPU metrics from spec.metrics[] and status.currentMetrics[] arrays
          const hpaJson = (hpa as any).jsonData;
          const targetMetric = hpaJson?.spec?.metrics?.find(
            (m: any) => m.type === 'Resource' && m.resource?.name === 'cpu'
          );
          const targetCPU = targetMetric?.resource?.target?.averageUtilization;

          const currentMetric = hpaJson?.status?.currentMetrics?.find(
            (m: any) => m.type === 'Resource' && m.resource?.name === 'cpu'
          );
          const currentCPU = currentMetric?.resource?.current?.averageUtilization;
          const hpaData: HPAInfo = {
            name: hpa.getName(),
            namespace: hpa.getNamespace(),
            minReplicas: hpa.spec?.minReplicas,
            maxReplicas: hpa.spec?.maxReplicas,
            targetCPUUtilization: targetCPU,
            currentCPUUtilization: currentCPU,
            currentReplicas: hpa.status?.currentReplicas,
            desiredReplicas: hpa.status?.desiredReplicas,
          };
          setHpaInfo(hpaData);
        } else {
          setHpaInfo(null);
        }
      },
      (error: any) => {
        console.error('Error fetching HPA info:', error);
        setHpaInfo(null);
      },
      {
        namespace,
        cluster,
      }
    ) as () => void | (() => void);

    const unsubscribe = runWatcher();
    if (typeof unsubscribe === 'function') {
      return unsubscribe;
    }

    return;
  }, [deploymentName, namespace, cluster]);

  return {
    hpaInfo,
  };
};
