// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { runAzCommand } from './az-cli-core';
import { withAbort } from './az-token';

/** Name, request destination and token scope from one CLI cloud configuration. */
interface AzureCloudEndpoints {
  /** Registered CLI cloud name, such as AzureCloud or AzureUSGovernment. */
  name: string;
  /** ARM base URL, with its final slash removed for request-path composition. */
  endpoint: string;
  /** Configured token resource plus `/.default`; preserves any resource trailing slash. */
  scope: string;
}

const CLOUD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const clouds = new Map<string, Promise<AzureCloudEndpoints>>();
const graphClouds = new Map<string, Promise<AzureCloudEndpoints>>();

/**
 * @param value - Untrusted endpoint field read from CLI cloud configuration.
 * @returns The original string, not a canonicalized URL, to preserve OAuth resource identity.
 * @throws For missing/invalid HTTPS URLs, credentials, query strings or fragments.
 */
function configuredHttpsUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Azure cloud endpoint is missing');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Azure cloud endpoints must be HTTPS URLs without credentials or queries');
  }
  return value;
}

/**
 * Reads local CLI cloud configuration without switching the active cloud.
 * @param cloudName - Registered cloud name from the selected account's environmentName.
 *   Omit to use the CLI's active cloud.
 * @param signal - Optional cancellation of this caller's wait, not the shared CLI process.
 * @returns Cached cloud name, ARM endpoint and exact token scope; account changes
 * invalidate the cache.
 * @throws For invalid names, CLI/configuration failures or cancellation. Failed
 * lookups are not cached and never fall back to public Azure.
 */
export function getAzureCloudEndpoints(
  cloudName?: string,
  signal?: AbortSignal
): Promise<AzureCloudEndpoints> {
  return getCloudEndpoints('arm', cloudName, signal);
}

/**
 * Resolves Microsoft Graph, not legacy Azure AD Graph, from the named CLI cloud.
 * @param cloudName - Selected account's cloud; omission reads the active CLI cloud.
 * @param signal - Optional cancellation of this caller's metadata wait.
 * @returns Validated Graph endpoint and matching Graph token scope.
 * @throws For missing/invalid configuration; never defaults to public Graph.
 */
export function getAzureGraphEndpoints(
  cloudName?: string,
  signal?: AbortSignal
): Promise<AzureCloudEndpoints> {
  return getCloudEndpoints('graph', cloudName, signal);
}

function getCloudEndpoints(
  service: 'arm' | 'graph',
  cloudName?: string,
  signal?: AbortSignal
): Promise<AzureCloudEndpoints> {
  if (cloudName !== undefined && !CLOUD_NAME_PATTERN.test(cloudName)) {
    return Promise.reject(new Error('Invalid Azure cloud name'));
  }
  const key = cloudName ?? '';
  const cache = service === 'arm' ? clouds : graphClouds;
  return withAbort(() => {
    let cloud = cache.get(key);
    if (!cloud) {
      cloud = (async () => {
        const result = await runAzCommand<AzureCloudEndpoints>(
          ['cloud', 'show', ...(cloudName ? ['--name', cloudName] : []), '--output', 'json'],
          'Reading Azure cloud endpoints:',
          `read Azure cloud ${cloudName ?? '(active)'}`,
          stdout => {
            const config: {
              name?: unknown;
              endpoints?: {
                resourceManager?: unknown;
                activeDirectoryResourceId?: unknown;
                microsoftGraphResourceId?: unknown;
              };
            } = JSON.parse(stdout);
            const name = cloudName ?? config.name;
            if (typeof name !== 'string' || !CLOUD_NAME_PATTERN.test(name)) {
              throw new Error('Azure cloud name is missing or invalid');
            }
            if (service === 'graph') {
              const endpoint = configuredHttpsUrl(
                config.endpoints?.microsoftGraphResourceId
              ).replace(/\/$/, '');
              return { name, endpoint, scope: `${endpoint}/.default` };
            }
            const endpoint = configuredHttpsUrl(config.endpoints?.resourceManager);
            const audience = configuredHttpsUrl(config.endpoints?.activeDirectoryResourceId);
            return {
              name,
              endpoint: endpoint.replace(/\/$/, ''),
              scope: `${audience}/.default`,
            };
          }
        );
        if (!result.success || !result.data) {
          throw new Error(
            result.error ?? `Azure cloud ${cloudName ?? '(active)'} returned no endpoints`
          );
        }
        return result.data;
      })();
      cache.set(key, cloud);
      cloud.catch(() => {
        if (cache.get(key) === cloud) cache.delete(key);
      });
    }
    return cloud;
  }, signal);
}

/** Drops cached cloud metadata so the next lookup re-reads the CLI's active cloud. */
export function clearAzureCloudCache(): void {
  clouds.clear();
  graphClouds.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('azure-auth-update', clearAzureCloudCache);
  window.addEventListener('azure-account-change', clearAzureCloudCache);
}
