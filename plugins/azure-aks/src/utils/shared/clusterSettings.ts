// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

export interface ClusterSettings {
  allowedNamespaces?: string[];
  [key: string]: unknown;
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
