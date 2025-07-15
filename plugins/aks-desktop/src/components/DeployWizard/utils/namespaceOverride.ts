// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Applies namespace override to a Kubernetes resource object.
 * Recursively handles List resources by applying the override to each item.
 *
 * @param obj - The Kubernetes resource object to process
 * @param namespace - The namespace to apply (optional)
 * @returns The object with namespace overridden
 */
export function applyNamespaceOverride(obj: any, namespace?: string): any {
  if (!obj || typeof obj !== 'object') return obj;

  // Handle List resources (e.g., PodList, ServiceList)
  if (obj.kind && obj.kind.endsWith('List') && Array.isArray(obj.items)) {
    obj.items = obj.items.map((item: any) => applyNamespaceOverride(item, namespace));
    return obj;
  }

  // Apply namespace to namespaced resources
  obj.metadata = obj.metadata || {};
  if (namespace) {
    obj.metadata.namespace = namespace;
  }

  return obj;
}
