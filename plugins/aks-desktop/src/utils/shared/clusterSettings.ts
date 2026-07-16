// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

export interface ClusterSettings {
  allowedNamespaces?: string[];
  /**
   * Discriminator persisted at registration time. Only `'aksarc'` is stored, for
   * Arc-connected (AKS Hybrid & Edge) clusters — it identifies them in the list
   * view and enables the proxy actions. Managed AKS clusters leave this unset, so
   * absence implies a managed cluster.
   */
  clusterType?: 'aks' | 'aksarc';
  /** Azure subscription ID owning the cluster (needed for AKS Hybrid & Edge proxy actions). */
  subscriptionId?: string;
  /** Azure resource group containing the cluster (needed for AKS Hybrid & Edge proxy actions). */
  resourceGroup?: string;
  /**
   * Per-cluster badge appearance. Shared verbatim with Headlamp core, which
   * reads `appearance.icon` / `appearance.accentColor` from this same
   * localStorage key to render the cluster-name badge on the Home table.
   */
  appearance?: {
    accentColor?: string;
    icon?: string;
  };
  [key: string]: unknown;
}

/**
 * Iconify icon and accent color used to mark AKS Hybrid & Edge (Arc-connected) clusters
 * on the Home cluster-name badge. `#0078d4` is the Azure brand blue.
 */
export const AKS_HYBRID_EDGE_BADGE_ICON = 'mdi:server';
export const AKS_HYBRID_EDGE_BADGE_ACCENT = '#0078d4';

/**
 * Gives an AKS Hybrid & Edge cluster a distinct name-badge (server icon + Azure-blue
 * accent) by writing Headlamp's `appearance` fields on the shared cluster
 * settings. Read-modify-write so unrelated settings are preserved; a
 * user-chosen icon is left untouched.
 *
 * @param clusterName - The kubeconfig context / Headlamp cluster name.
 */
export function markAksHybridEdgeAppearance(clusterName: string): void {
  if (!clusterName) {
    return;
  }
  const existing = getClusterSettings(clusterName);
  const appearance = existing.appearance ?? {};
  setClusterSettings(clusterName, {
    ...existing,
    appearance: {
      ...appearance,
      icon: appearance.icon ?? AKS_HYBRID_EDGE_BADGE_ICON,
      accentColor: appearance.accentColor ?? AKS_HYBRID_EDGE_BADGE_ACCENT,
    },
  });
}

/**
 * Reads and parses cluster settings from localStorage.
 * Returns a plain object with the parsed settings,
 * or an empty object if the key is missing or unparseable.
 */
export function getClusterSettings(clusterName: string): ClusterSettings {
  try {
    const raw = localStorage.getItem(`cluster_settings.${clusterName}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as ClusterSettings;
      }
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Writes cluster settings back to localStorage.
 */
export function setClusterSettings(clusterName: string, settings: ClusterSettings): void {
  localStorage.setItem(`cluster_settings.${clusterName}`, JSON.stringify(settings));
}
