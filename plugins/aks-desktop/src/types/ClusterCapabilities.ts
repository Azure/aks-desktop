// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

export interface ClusterCapabilities {
  /** Cluster SKU tier */
  sku: 'Automatic' | 'Base' | null;
  /** Whether Azure Entra ID (AAD) authentication is enabled */
  aadEnabled: boolean | null;
  /** Whether Azure RBAC for Kubernetes authorization is enabled */
  azureRbacEnabled: boolean | null;
  /** Network policy engine */
  networkPolicy: 'calico' | 'cilium' | 'azure' | 'none' | null;
  /** Network plugin */
  networkPlugin: 'azure' | 'kubenet' | 'none' | null;
  /** Whether Azure Monitor metrics (Managed Prometheus) is enabled */
  prometheusEnabled: boolean | null;
  /** Whether Container Insights (OMS agent) is enabled */
  containerInsightsEnabled: boolean | null;
  /** Whether KEDA addon is enabled */
  kedaEnabled: boolean | null;
  /** Whether VPA addon is enabled */
  vpaEnabled: boolean | null;
}
