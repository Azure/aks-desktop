// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { runAzCommand } from './az-cli-core';
import { withAbort } from './az-token';

/** Request destination and token scope from one named CLI cloud configuration. */
interface AzureCloudEndpoints {
  /** ARM base URL, with its final slash removed for request-path composition. */
  endpoint: string;
  /** Configured token resource plus `/.default`; preserves any resource trailing slash. */
  scope: string;
}

const clouds = new Map<string, Promise<AzureCloudEndpoints>>();

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
 * @returns Cached ARM endpoint and exact token scope; account changes invalidate the cache.
 * @throws For invalid names, CLI/configuration failures or cancellation. Failed
 * lookups are not cached and never fall back to public Azure.
 */
export function getAzureCloudEndpoints(
  cloudName?: string,
  signal?: AbortSignal
): Promise<AzureCloudEndpoints> {
  if (cloudName !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(cloudName)) {
    return Promise.reject(new Error('Invalid Azure cloud name'));
  }
  const key = cloudName ?? '';
  return withAbort(() => {
    let cloud = clouds.get(key);
    if (!cloud) {
      cloud = (async () => {
        const result = await runAzCommand<AzureCloudEndpoints>(
          ['cloud', 'show', ...(cloudName ? ['--name', cloudName] : []), '--output', 'json'],
          'Reading Azure cloud endpoints:',
          `read Azure cloud ${cloudName ?? '(active)'}`,
          stdout => {
            const config: {
              endpoints?: { resourceManager?: unknown; activeDirectoryResourceId?: unknown };
            } = JSON.parse(stdout);
            const endpoint = configuredHttpsUrl(config.endpoints?.resourceManager);
            const audience = configuredHttpsUrl(config.endpoints?.activeDirectoryResourceId);
            return {
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
      clouds.set(key, cloud);
      cloud.catch(() => {
        if (clouds.get(key) === cloud) clouds.delete(key);
      });
    }
    return cloud;
  }, signal);
}

if (typeof window !== 'undefined') {
  window.addEventListener('azure-auth-update', () => clouds.clear());
}
