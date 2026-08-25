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
  /** Additional Headlamp-owned settings preserved during read-modify-write updates. */
  [key: string]: unknown;
}

const CLUSTER_SETTINGS_PREFIX = 'cluster_settings.';

/**
 * Resolves the stored settings key for a case-insensitive cluster identity.
 *
 * @param clusterName - Cluster name whose settings key should be resolved.
 * @returns The existing case-preserving key, or the requested key when none exists.
 */
function findClusterSettingsKey(clusterName: string): string {
  const exactKey = `${CLUSTER_SETTINGS_PREFIX}${clusterName}`;
  if (localStorage.getItem(exactKey) !== null) {
    return exactKey;
  }

  const normalizedKey = exactKey.toLowerCase();
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.toLowerCase() === normalizedKey) {
      return key;
    }
  }
  return exactKey;
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
