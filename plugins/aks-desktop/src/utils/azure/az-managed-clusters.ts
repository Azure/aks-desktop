// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import type { ClusterType } from './aks';
import { azRequest, type AzRequestOptions, AzureRequestError } from './az-http';
import { getSubscriptionCredential } from './az-token';

/** Managed AKS coordinates plus transport overrides inherited from AzRequestOptions. */
export type AksClusterReadOptions = Pick<
  AzRequestOptions,
  'credential' | 'endpoint' | 'scope' | 'tenantId' | 'signal' | 'timeoutMs'
> & {
  /** Explicit subscription GUID used by the URL and default account-bound credential. */
  subscriptionId: string;
  /** Resource group containing the cluster. */
  resourceGroup: string;
  /** Managed AKS resource name, not a kubeconfig context or ARM ID. */
  clusterName: string;
  /** Optional discriminator; any supplied value other than aks is rejected before HTTP. */
  clusterType?: ClusterType;
};

/** Minimal ARM 2026-01-01 detail shape, retaining top-level SKU and nested properties. */
export interface ManagedClusterDetails {
  /** Full cluster ARM ID, if returned. */
  id?: string;
  /** Provider type; when present it must identify Microsoft.ContainerService/managedClusters. */
  type?: string;
  /** Managed cluster resource name. */
  name?: string;
  /** Azure resource region, distinct from any node-pool zone. */
  location?: string | null;
  /** SKU metadata belongs at the resource top level, not under properties. */
  sku?: {
    /** AKS SKU name, such as Base or Automatic. */
    name?: ClusterCapabilities['sku'];
    /** Service tier, such as Free, Standard or Premium. */
    tier?: string | null;
  } | null;
  /** Required ARM property container; individual profiles may be absent or null. */
  properties: {
    /** Deployment state; readiness requires Succeeded together with Running power. */
    provisioningState?: string | null;
    /** Observed cluster power state, independent of provisioning. */
    powerState?: {
      /** Azure power code, such as Running or Stopped. */
      code?: string | null;
    } | null;
    /** Cluster Kubernetes version reported by ARM. */
    kubernetesVersion?: string | null;
    /** Additional ARM status diagnostics, preserved without flattening. */
    status?: {
      /** Optional provisioning failure details. */
      provisioningError?: {
        /** Azure failure code. */
        code?: string;
        /** Service-provided diagnostic. */
        message?: string;
      };
    } | null;
    /** Presence indicates Entra authentication; enableAzureRBAC controls authorization separately. */
    aadProfile?: {
      /** ARM-cased Azure RBAC flag; false is distinct from absent/null. */
      enableAzureRBAC?: boolean | null;
    } | null;
    /** Network implementation and policy-engine capabilities. */
    networkProfile?: {
      /** Policy engine; capability projection defaults missing/empty values to none. */
      networkPolicy?: ClusterCapabilities['networkPolicy'];
      /** Network plugin; absent/empty projects to null. */
      networkPlugin?: ClusterCapabilities['networkPlugin'];
    } | null;
    /** Managed addon configuration. */
    addonProfiles?: {
      /** Container Insights addon profile. */
      omsagent?: {
        /** Whether the addon is enabled. */
        enabled?: boolean | null;
      } | null;
    } | null;
    /** Azure Monitor integration settings. */
    azureMonitorProfile?: {
      /** Managed Prometheus metrics configuration. */
      metrics?: {
        /** Whether metrics collection is enabled. */
        enabled?: boolean | null;
      } | null;
    } | null;
    /** Workload autoscaler profiles; missing booleans remain indeterminate. */
    workloadAutoScalerProfile?: {
      /** Kubernetes Event-driven Autoscaling configuration. */
      keda?: {
        /** Whether KEDA is enabled. */
        enabled?: boolean | null;
      } | null;
      /** Vertical Pod Autoscaler configuration. */
      verticalPodAutoscaler?: {
        /** Whether VPA is enabled. */
        enabled?: boolean | null;
      } | null;
    } | null;
    /** Node identity profile, distinct from the top-level control-plane identity. */
    identityProfile?: {
      /** Raw kubelet identity; callers validate objectId as a GUID before granting roles. */
      kubeletidentity?: unknown;
    } | null;
    /** OIDC profile with ARM's issuerURL casing. */
    oidcIssuerProfile?: {
      /** Issuer URL used by Kubernetes workload federation. */
      issuerURL?: string | null;
      /** Whether the OIDC issuer feature is enabled. */
      enabled?: boolean;
    } | null;
    /** Cluster security feature settings. */
    securityProfile?: {
      /** Workload identity must be enabled in addition to an OIDC issuer URL. */
      workloadIdentity?: {
        /** Whether workload identity is enabled. */
        enabled?: boolean | null;
      } | null;
    } | null;
  };
}

/**
 * Reads the ARM shape without CLI flattening or managed AKS requests against Arc.
 * @param options - Explicit coordinates and optional credential, cloud, tenant and deadline controls.
 * @returns Fresh details with raw ARM nesting; this helper does not cache resource state.
 * @throws For invalid/missing coordinates, Arc resources, malformed properties,
 * credential/HTTP failures or cancellation. Default authentication binds to the subscription.
 */
export async function getManagedClusterDetails(
  options: AksClusterReadOptions
): Promise<ManagedClusterDetails> {
  if (options.clusterType && options.clusterType !== 'aks') {
    throw new AzureRequestError('Managed AKS detail reads do not support Arc clusters');
  }
  const { subscriptionId, resourceGroup, clusterName } = options;
  if (![subscriptionId, resourceGroup, clusterName].every(value => value?.trim())) {
    throw new AzureRequestError('Subscription, resource group and cluster name are required');
  }
  const cluster = await azRequest<ManagedClusterDetails>({
    ...options,
    credential: options.credential ?? getSubscriptionCredential(subscriptionId),
    url: `/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(
      resourceGroup
    )}/providers/Microsoft.ContainerService/managedClusters/${encodeURIComponent(clusterName)}`,
    apiVersion: '2026-01-01',
  });
  if (
    !cluster?.properties ||
    typeof cluster.properties !== 'object' ||
    Array.isArray(cluster.properties)
  ) {
    throw new AzureRequestError('Malformed managed AKS detail response: properties are missing');
  }
  if (cluster.type && cluster.type.toLowerCase() !== 'microsoft.containerservice/managedclusters') {
    throw new AzureRequestError('Expected a managed AKS cluster, not an Arc resource');
  }
  return cluster;
}
