/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { getCluster } from '../lib/cluster';

/**
 * ClusterSettings defines the structure of the cluster settings object.
 */
export interface ClusterSettings {
  /** Optional default namespace to be used */
  defaultNamespace?: string;
  /** Only allow namespaces in this list to be selected */
  allowedNamespaces?: string[];
  /** This is a custom cluster name. If it is '' it is the actual cluster name. */
  currentName?: string;
  nodeShellTerminal?: {
    linuxImage?: string;
    namespace?: string;
    isEnabled?: boolean;
  };
}

export const DEFAULT_NODE_SHELL_LINUX_IMAGE = 'docker.io/library/alpine:latest';
export const DEFAULT_NODE_SHELL_NAMESPACE = 'kube-system';

/**
 * Stores the cluster settings in local storage.
 *
 * @param clusterName - The name of the cluster.
 * @param settings - The cluster settings to be stored.
 * @returns {void}
 */
export function storeClusterSettings(clusterName: string, settings: ClusterSettings) {
  if (!clusterName) {
    return;
  }
  localStorage.setItem(`cluster_settings.${clusterName}`, JSON.stringify(settings));
}

/**
 * Loads the cluster settings from local storage.
 *
 * @param clusterName - The name of the cluster.
 * @returns {ClusterSettings} - The cluster settings.
 */
export function loadClusterSettings(clusterName: string): ClusterSettings {
  if (!clusterName) {
    return {};
  }
  const settings = JSON.parse(localStorage.getItem(`cluster_settings.${clusterName}`) || '{}');
  return settings;
}

/**
 * Gives an optionally configured list of allowed namespaces.
 *
 * @param cluster Optional cluster to check for allowed namespaces.
 *                If not given the current cluster allowed name spaces are used.
 *
 * @returns A list of configured name spaces for the given cluster or current cluster.
 *          If a zero length list, then no allowed namespace has been configured for cluster.
 *          If length > 0, allowed namespaces have been configured for this cluster.
 *          If not in a cluster it returns [].
 *
 * There are cases where a user doesn't have the authority to list
 * all the namespaces. In that case it becomes difficult to access things
 * around Headlamp. To prevent this we can allow the user to pass a set
 * of namespaces they know they have access to and we can use this set to
 * make requests to the API server.
 */

export function getAllowedNamespaces(cluster: string | null = getCluster()): string[] {
  if (!cluster) {
    return [];
  }

  const clusterSettings = loadClusterSettings(cluster);
  return clusterSettings.allowedNamespaces || [];
}
