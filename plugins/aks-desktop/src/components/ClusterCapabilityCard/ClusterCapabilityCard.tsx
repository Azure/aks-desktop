// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Typography } from '@mui/material';
import React, { useEffect } from 'react';
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import { ClusterConfigurePanel } from '../CreateAKSProject/components/ClusterConfigurePanel';
import { useClusterCapabilities } from '../CreateAKSProject/hooks/useClusterCapabilities';

interface ClusterCapabilityCardProps {
  project: {
    namespaces: string[];
    clusters: string[];
  };
}

const hasConfigurableAddons = (cap: ClusterCapabilities): boolean => {
  return cap.prometheusEnabled !== true || cap.kedaEnabled !== true || cap.vpaEnabled !== true;
};

const hasIssues = (cap: ClusterCapabilities): boolean => {
  return (
    hasConfigurableAddons(cap) ||
    cap.azureRbacEnabled !== true ||
    !cap.networkPolicy ||
    cap.networkPolicy === 'none'
  );
};

function ClusterCapabilityCard({ project }: ClusterCapabilityCardProps) {
  const namespace = project.namespaces?.[0];
  const cluster = project.clusters?.[0];

  const [namespaceInstance] = K8s.ResourceClasses.Namespace.useGet(namespace, undefined, {
    cluster,
  });
  const subscription =
    namespaceInstance?.jsonData?.metadata?.labels?.['aks-desktop/project-subscription'];
  const resourceGroup =
    namespaceInstance?.jsonData?.metadata?.labels?.['aks-desktop/project-resource-group'];

  const { capabilities, loading, error, fetchCapabilities } = useClusterCapabilities();

  useEffect(() => {
    if (subscription && resourceGroup && cluster) {
      fetchCapabilities(subscription, resourceGroup, cluster);
    }
  }, [subscription, resourceGroup, cluster]);

  // Don't show anything while loading or if we don't have data yet
  if (loading) return null;

  // Show error if capability check failed
  if (error) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Cluster Configuration
        </Typography>
        <Alert severity="warning">
          Unable to check cluster capabilities. Some features may require additional cluster
          configuration.
        </Alert>
      </Box>
    );
  }

  if (!capabilities) return null;

  // Don't show anything if the cluster has all capabilities
  if (!hasIssues(capabilities)) return null;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Cluster Configuration
      </Typography>
      {capabilities.azureRbacEnabled !== true && (
        <Alert severity="error" sx={{ mb: 1 }}>
          Azure RBAC for Kubernetes is not enabled. Project role assignments (Admin, Writer, Reader)
          will not work. This must be set at cluster creation.
        </Alert>
      )}
      {(!capabilities.networkPolicy || capabilities.networkPolicy === 'none') && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          No network policy engine configured. Network policies will not be enforced. This must be
          set at cluster creation.
        </Alert>
      )}
      {!capabilities.prometheusEnabled && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Managed Prometheus is not enabled. Metrics charts will be unavailable until enabled.
        </Alert>
      )}
      {(!capabilities.kedaEnabled || !capabilities.vpaEnabled) && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {!capabilities.kedaEnabled && !capabilities.vpaEnabled
            ? 'KEDA and VPA are not enabled. Autoscaling features will be limited.'
            : !capabilities.kedaEnabled
            ? 'KEDA is not enabled. Event-driven autoscaling will be unavailable.'
            : 'VPA is not enabled. Vertical pod autoscaling will be unavailable.'}
        </Alert>
      )}
      {hasConfigurableAddons(capabilities) && subscription && resourceGroup && cluster && (
        <ClusterConfigurePanel
          capabilities={capabilities}
          subscriptionId={subscription}
          resourceGroup={resourceGroup}
          clusterName={cluster}
          onConfigured={() => {
            if (subscription && resourceGroup && cluster) {
              fetchCapabilities(subscription, resourceGroup, cluster);
            }
          }}
        />
      )}
    </Box>
  );
}

export default ClusterCapabilityCard;
