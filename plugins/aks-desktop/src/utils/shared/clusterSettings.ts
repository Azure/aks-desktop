// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Persisted Headlamp settings associated with one canonical cluster identity. */
export interface ClusterSettings {
  /** Namespace restriction retained for existing cluster visibility behavior. */
  allowedNamespaces?: string[];
  /** Azure resource identity used when this kubeconfig cluster was registered. */
  azureRegistration?: {
    /** Azure subscription containing the registered cluster. */
    subscriptionId: string;
    /** Azure resource group containing the registered cluster. */
    resourceGroup: string;
  };
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
  /** Additional Headlamp-owned settings preserved during read-modify-write updates. */
  [key: string]: unknown;
}

const CLUSTER_SETTINGS_PREFIX = 'cluster_settings.';

/**
 * Resolves the stored settings key for a case-insensitive cluster identity.
 * Throws when legacy storage contains multiple case variants so callers fail closed.
 *
 * @param clusterName - Cluster name whose settings key should be resolved.
 * @returns The existing case-preserving key, or the requested key when none exists.
 */
function findClusterSettingsKey(clusterName: string): string {
  const exactKey = `${CLUSTER_SETTINGS_PREFIX}${clusterName}`;
  const normalizedKey = exactKey.toLowerCase();
  const matchingKeys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.toLowerCase() === normalizedKey) {
      matchingKeys.push(key);
    }
  }
  if (matchingKeys.length > 1) {
    throw new Error(`Multiple settings entries exist for cluster '${clusterName}'.`);
  }
  return matchingKeys[0] ?? exactKey;
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
 *
 * @param clusterName - Cluster whose persisted settings should be read.
 * @returns Parsed cluster settings, or an empty object when unavailable or invalid.
 */
export function getClusterSettings(clusterName: string): ClusterSettings {
  try {
    const raw = localStorage.getItem(findClusterSettingsKey(clusterName));
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
 *
 * @param clusterName - Cluster whose persisted settings should be replaced.
 * @param settings - Complete settings object to serialize.
 * @returns Nothing.
 */
export function setClusterSettings(clusterName: string, settings: ClusterSettings): void {
  localStorage.setItem(findClusterSettingsKey(clusterName), JSON.stringify(settings));
}
