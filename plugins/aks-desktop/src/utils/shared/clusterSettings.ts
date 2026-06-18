// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Per-cluster metadata persisted in localStorage. */
export interface ClusterSettings {
  /** Namespaces the user is allowed to access in this cluster. */
  allowedNamespaces?: string[];
  /** Discriminator stored at registration time: `'aks'` for managed clusters, `'aksarc'` for Arc-connected clusters. */
  clusterType?: 'aks' | 'aksarc';
  /** Azure subscription ID owning the cluster. */
  subscriptionId?: string;
  /** Azure resource group containing the cluster. */
  resourceGroup?: string;
  [key: string]: unknown;
}

/**
 * Builds the localStorage key for a cluster's settings.
 *
 * When `subscriptionId` and `resourceGroup` are provided the key includes
 * them so that two clusters with the same name in different
 * subscriptions/resource-groups do not collide.  Falls back to the
 * legacy `cluster_settings.${clusterName}` format when the extra
 * identifiers are unavailable.
 */
export function clusterSettingsKey(
  clusterName: string,
  subscriptionId?: string,
  resourceGroup?: string
): string {
  if (subscriptionId && resourceGroup) {
    return `cluster_settings.${subscriptionId}.${resourceGroup}.${clusterName}`;
  }
  return `cluster_settings.${clusterName}`;
}

/** Attempt to parse a localStorage value as a plain object. */
function parseSettingsValue(raw: string | null): ClusterSettings | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ClusterSettings;
    }
  } catch {
    /* unparseable – treat as missing */
  }
  return undefined;
}

/**
 * Reads and parses cluster settings from localStorage.
 * Returns a plain object with the parsed settings,
 * or an empty object if the key is missing or unparseable.
 *
 * When `subscriptionId` and `resourceGroup` are provided the
 * disambiguated key is tried first, then the legacy key as a fallback.
 *
 * When called with only `clusterName` the function scans localStorage
 * for disambiguated entries whose key ends with `.${clusterName}`.  If
 * exactly one match is found it is returned; otherwise the legacy key
 * is used (avoids ambiguity when the same cluster name exists in
 * multiple subscriptions/resource-groups).
 */
export function getClusterSettings(
  clusterName: string,
  subscriptionId?: string,
  resourceGroup?: string
): ClusterSettings {
  try {
    const key = clusterSettingsKey(clusterName, subscriptionId, resourceGroup);
    const result = parseSettingsValue(localStorage.getItem(key));
    if (result) return result;

    // Fall back to the legacy key when the qualified key has no entry,
    // but only if there are no other disambiguated entries for the same
    // clusterName – otherwise the legacy entry is ambiguous and could
    // belong to a different cluster with the same name.
    if (subscriptionId && resourceGroup) {
      const suffix = `.${clusterName}`;
      const prefix = 'cluster_settings.';
      let hasDisambiguated = false;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (
          k &&
          k.startsWith(prefix) &&
          k.endsWith(suffix) &&
          k !== key &&
          k !== `cluster_settings.${clusterName}`
        ) {
          hasDisambiguated = true;
          break;
        }
      }
      if (!hasDisambiguated) {
        return parseSettingsValue(localStorage.getItem(`cluster_settings.${clusterName}`)) ?? {};
      }
      return {};
    }

    // No subscription/resourceGroup supplied – look for a unique disambiguated entry.
    const suffix = `.${clusterName}`;
    const prefix = 'cluster_settings.';
    let match: ClusterSettings | undefined;
    let matchCount = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && k.endsWith(suffix) && k !== key) {
        const candidate = parseSettingsValue(localStorage.getItem(k));
        if (candidate) {
          match = candidate;
          matchCount++;
          if (matchCount > 1) break; // ambiguous – stop early
        }
      }
    }
    if (matchCount === 1 && match) return match;

    return {};
  } catch {
    return {};
  }
}

/**
 * Writes cluster settings back to localStorage.
 *
 * Uses the disambiguated key when `subscriptionId` and `resourceGroup`
 * are present in the settings object, otherwise falls back to the
 * legacy key.
 */
export function setClusterSettings(clusterName: string, settings: ClusterSettings): void {
  const key = clusterSettingsKey(clusterName, settings.subscriptionId, settings.resourceGroup);
  localStorage.setItem(key, JSON.stringify(settings));
}
