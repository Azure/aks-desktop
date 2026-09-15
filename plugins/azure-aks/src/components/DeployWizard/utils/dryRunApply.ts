// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { clusterRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';

interface KubeResource {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

interface ResourceInfo {
  plural: string;
  namespaced: boolean;
}

interface DiscoveryCacheEntry extends ResourceInfo {
  kind: string;
}

// Module-level cache: keyed by cluster + discovery URL, stores a Promise of resource info for each
// API group. Caching the Promise (not the resolved value) ensures that concurrent callers for the
// same API group await the same in-flight request instead of issuing duplicate GETs. Each API group
// per cluster is fetched at most once per page load. The cache has no TTL — if a CRD is installed
// while the app is open, a page reload is needed to pick it up.
const discoveryCache = new Map<string, Promise<DiscoveryCacheEntry[]>>();

export function clearDiscoveryCache(): void {
  discoveryCache.clear();
}

/**
 * Discovers the plural name and scope of a Kubernetes resource kind
 * by querying the API server's discovery endpoint.
 */
export async function discoverResource(
  apiVersion: string,
  kind: string,
  cluster?: string
): Promise<ResourceInfo> {
  const discoveryUrl = apiVersion === 'v1' ? '/api/v1' : `/apis/${apiVersion}`;
  const cacheKey = `${cluster ?? ''}\0${discoveryUrl}`;

  let resourcesPromise = discoveryCache.get(cacheKey);
  if (!resourcesPromise) {
    resourcesPromise = clusterRequest(discoveryUrl, {
      method: 'GET',
      cluster,
    })
      .then((response: any) =>
        (response.resources || []).map((r: any) => ({
          plural: r.name,
          namespaced: r.namespaced,
          kind: r.kind,
        }))
      )
      .catch(err => {
        // Remove failed entry so subsequent calls can retry
        discoveryCache.delete(cacheKey);
        throw err;
      });
    discoveryCache.set(cacheKey, resourcesPromise);
  }

  const resources = await resourcesPromise;

  const candidates = resources.filter(r => r.kind === kind);
  // Prefer the primary resource (e.g. "pods") over subresources (e.g. "pods/status")
  const entry = candidates.find(r => !r.plural.includes('/')) ?? candidates[0];
  if (!entry) {
    throw new Error(`Unknown resource kind "${kind}" in API group "${apiVersion}"`);
  }
  return { plural: entry.plural, namespaced: entry.namespaced };
}

export async function buildApiPath(resource: KubeResource, cluster?: string): Promise<string> {
  const apiVersion = resource.apiVersion || 'v1';
  const kind = resource.kind || '';
  const { plural, namespaced } = await discoverResource(apiVersion, kind, cluster);

  // Core API group (v1) uses /api/v1, others use /apis/<group>/<version>
  const base = apiVersion === 'v1' ? '/api/v1' : `/apis/${apiVersion}`;

  if (!namespaced) {
    return `${base}/${plural}`;
  }

  const ns = resource.metadata?.namespace || 'default';
  return `${base}/namespaces/${ns}/${plural}`;
}

export async function buildResourcePath(resource: KubeResource, cluster?: string): Promise<string> {
  const basePath = await buildApiPath(resource, cluster);
  const name = resource.metadata?.name;
  if (!name) {
    return basePath;
  }
  return `${basePath}/${name}`;
}

/**
 * Performs a server-side dry-run apply for a Kubernetes resource.
 * This triggers all admission webhooks (including Gatekeeper) without persisting the resource.
 * Throws an error with the admission webhook message if validation fails.
 *
 * Semantics:
 * - Try a dry-run create (POST to the collection endpoint).
 * - If the resource already exists (409), retry as a dry-run update (PATCH to the named resource).
 */
export async function dryRunApply(resource: KubeResource, cluster?: string): Promise<void> {
  const collectionPath = `${await buildApiPath(resource, cluster)}?dryRun=All`;

  try {
    await clusterRequest(collectionPath, {
      method: 'POST',
      body: JSON.stringify(resource),
      headers: {
        'Content-Type': 'application/json',
      },
      cluster,
    });
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status;

    if (status === 409) {
      const namedPath = `${await buildResourcePath(resource, cluster)}?dryRun=All`;
      await clusterRequest(namedPath, {
        method: 'PATCH',
        body: JSON.stringify(resource),
        headers: {
          'Content-Type': 'application/merge-patch+json',
        },
        cluster,
      });
      return;
    }

    throw err;
  }
}
