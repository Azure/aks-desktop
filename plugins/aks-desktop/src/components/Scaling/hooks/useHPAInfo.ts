// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';

export interface HPAInfo {
  name: string;
  namespace: string;
  minReplicas: number | undefined;
  maxReplicas: number | undefined;
  targetCPUUtilization: number | undefined;
  currentCPUUtilization: number | undefined;
  currentReplicas: number | undefined;
  desiredReplicas: number | undefined;
}

interface UseHPAInfoResult {
  hpaInfo: HPAInfo | null;
}

/**
 * Custom hook to fetch Horizontal Pod Autoscaler (HPA) information for a deployment
 */
export const useHPAInfo = (
  deploymentName: string | undefined,
  namespace: string | undefined,
  cluster: string | undefined
): UseHPAInfoResult => {
  const [hpaInfo, setHpaInfo] = useState<HPAInfo | null>(null);

  useEffect(() => {
    if (!deploymentName || !namespace) return;

    try {
      // Find HPA that targets this deployment
      const cancel = K8s.ResourceClasses.HorizontalPodAutoscaler.apiList(
        (hpaList: K8s.HorizontalPodAutoscaler[]) => {
          const hpa = hpaList.find(
            (hpa: K8s.HorizontalPodAutoscaler) =>
              hpa.getNamespace() === namespace && hpa.spec?.scaleTargetRef?.name === deploymentName
          );
          console.log('hpa is ', hpa);
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
      )();

      // Return cleanup function
      return cancel;
    } catch (error) {
      console.error('Error in fetchHPAInfo:', error);
      setHpaInfo(null);
      return undefined;
    }
  }, [deploymentName, namespace, cluster]);

  return {
    hpaInfo,
  };
};
