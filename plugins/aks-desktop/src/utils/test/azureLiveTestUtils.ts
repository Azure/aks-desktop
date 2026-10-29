// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { TokenCredential } from '@azure/identity';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { azListAll, azRequest, azRequestRaw, AzureRequestError } from '../azure/az-http';

/** Default CLI subscription name; AZ_LIVE_SUBSCRIPTION can override it with a GUID. */
export const DEFAULT_LIVE_SUBSCRIPTION = 'Cloud Native Tools';
/** Ownership prefix shared by run groups, AKS node groups and the inventory command. */
export const AZURE_TEST_RESOURCE_PREFIX = 'aksd-rest-e2e-';
/** Two-hour test budget, including slow provisioning and observed group cleanup. */
export const AZURE_LIVE_TEST_TIMEOUT = 120 * 60_000;
const RESOURCE_API_VERSION = '2021-04-01';

/** Authenticated public-cloud ARM context for opt-in tests and read-only inventory. */
export interface AzureLiveContext {
  /** Subscription GUID returned for the explicitly selected CLI account. */
  subscriptionId: string;
  /** Tenant GUID returned with that account's token. */
  tenantId: string;
  /** In-memory token source, refreshed through CLI only on expiry and never logged. */
  credential: TokenCredential;
}

/** Run-owned coordinates passed to a test whose wrapper owns group cleanup. */
export interface AzureLiveResourceGroup extends AzureLiveContext {
  /** Unique group name containing the prefix, suite, UTC timestamp and random suffix. */
  resourceGroup: string;
  /** Complete ARM resource ID of the run's primary resource group. */
  resourceGroupId: string;
  /** Reserved AKS node-group name, derived by appending -nodes to the primary group. */
  nodeResourceGroup: string;
  /** Resource region; AZ_LIVE_LOCATION or eastus2 by default. */
  location: string;
  /** Timestamp/random identifier used to correlate resources and diagnostics. */
  runId: string;
  /** Ownership, suite, run and creation-time tags to apply to test resources. */
  tags: Record<string, string>;
}

/** Preserves the original test failure together with any independent cleanup failures. */
class AzureLiveTestError extends Error {
  /**
   * @param errors - Original setup/test failure followed by cleanup failures.
   * @param resourceGroup - Owned group name included in the diagnostic.
   */
  constructor(readonly errors: unknown[], resourceGroup: string) {
    super(
      `Azure test or cleanup failed for ${resourceGroup}: ${errors
        .map(error => (error instanceof Error ? error.message : String(error)))
        .join('; ')}`
    );
    this.name = 'AzureLiveTestError';
  }
}

/** True only when AZ_LIVE_TESTS=1 and az is discoverable; does not establish a session. */
export const azureLiveEnabled =
  process.env.AZ_LIVE_TESTS === '1' &&
  spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['az'], {
    stdio: 'ignore',
    timeout: 10_000,
  }).status === 0;

/**
 * Bootstraps one CLI token; all resource operations use the returned REST credential.
 * @param platform - Host platform, overridable to test Windows shell quoting.
 * @returns Selected subscription/tenant GUIDs and a credential that refreshes on
 * expiry, rejecting an account/tenant change during a long-running test.
 * @throws For invalid AZ_LIVE_SUBSCRIPTION, missing login, malformed token or
 * invalid expiry. Defaults to Cloud Native Tools, not the ambient subscription.
 */
export function getLiveAzureContext(
  platform: NodeJS.Platform = process.platform
): AzureLiveContext {
  const args = [
    'account',
    'get-access-token',
    '--scope',
    'https://management.azure.com/.default',
    '-o',
    'json',
  ];
  const override = process.env.AZ_LIVE_SUBSCRIPTION || undefined;
  if (override) {
    if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(override)) {
      throw new Error('AZ_LIVE_SUBSCRIPTION must be a subscription GUID');
    }
  }
  const selected = override ?? DEFAULT_LIVE_SUBSCRIPTION;
  args.push('--subscription', platform === 'win32' ? `"${selected}"` : selected);
  const result = spawnSync('az', args, {
    shell: platform === 'win32',
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Azure live tests require a working az login session');
  }
  let token: {
    accessToken?: string;
    expires_on?: number;
    subscription?: string;
    tenant?: string;
  };
  try {
    token = JSON.parse(result.stdout);
  } catch {
    throw new Error('Azure CLI returned an invalid token response');
  }
  const accessToken = token.accessToken;
  const expiresOnTimestamp = Number(token.expires_on) * 1000;
  const subscriptionId = token.subscription;
  if (!accessToken || !subscriptionId || !token.tenant || !(expiresOnTimestamp > Date.now())) {
    throw new Error(
      'Azure CLI token response is missing subscription, tenant or valid token fields'
    );
  }
  let refreshedCredential: TokenCredential | undefined;
  return {
    subscriptionId,
    tenantId: token.tenant,
    credential: {
      getToken: async (scopes, options) => {
        if (refreshedCredential) return refreshedCredential.getToken(scopes, options);
        if (expiresOnTimestamp <= Date.now()) {
          const refreshed = getLiveAzureContext(platform);
          if (refreshed.subscriptionId !== subscriptionId || refreshed.tenantId !== token.tenant) {
            throw new Error('Azure live test account changed while refreshing the token');
          }
          refreshedCredential = refreshed.credential;
          return refreshedCredential.getToken(scopes, options);
        }
        return { token: accessToken, expiresOnTimestamp };
      },
    },
  };
}

/**
 * @param context - Authenticated account owning the run group.
 * @param name - Exact run-owned primary or node group name; never a wildcard.
 * @returns Only after a known ResourceGroupNotFound response confirms absence.
 * @throws On permanent failures, exhausted transient retries or the 30-minute deadline.
 */
async function deleteTestResourceGroup(context: AzureLiveContext, name: string): Promise<void> {
  const url = `/subscriptions/${context.subscriptionId}/resourceGroups/${encodeURIComponent(name)}`;
  const deadline = Date.now() + 30 * 60_000;
  /**
   * @param method - Idempotent group DELETE or read-only absence check.
   * @returns The raw response within the shared cleanup deadline.
   * @throws After bounded transient retries; permission failures are not retried.
   */
  const cleanupRequest = async (method: 'GET' | 'DELETE') => {
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Timed out deleting test resource group ${name}`);
      try {
        return await azRequestRaw({
          ...context,
          url,
          method,
          apiVersion: RESOURCE_API_VERSION,
          timeoutMs: Math.min(60_000, remaining),
        });
      } catch (error) {
        const transient =
          error instanceof AzureRequestError &&
          (error.status !== undefined
            ? [408, 429, 500, 502, 503, 504].includes(error.status)
            : /Azure request (failed before a response|timed out)/.test(error.message));
        if (!transient || attempt >= 2 || Date.now() >= deadline) throw error;
        // DELETE is idempotent and restricted to this run's exact owned group.
        console.warn(`Retrying ${method} cleanup for test resource group ${name}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  };
  try {
    await cleanupRequest('DELETE');
    for (;;) {
      await cleanupRequest('GET');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    if (
      error instanceof AzureRequestError &&
      error.status === 404 &&
      error.code === 'ResourceGroupNotFound'
    )
      return;
    throw error;
  }
}

/**
 * Creates a unique tagged group and cleans both owned groups in finally.
 * @param suite - Lowercase alphanumeric/hyphen identifier, 1-24 characters.
 * @param context - Explicit account/credential used for setup, test and teardown.
 * @param test - Callback receiving owned coordinates; must finish before cleanup.
 * @returns After the callback and observed primary/node-group deletion complete.
 * @throws The sole original failure, or AzureLiveTestError containing all failures.
 * Cleanup is attempted even after uncertain setup writes or assertion failures.
 */
export async function withAzureTestResourceGroup(
  suite: string,
  context: AzureLiveContext,
  test: (run: AzureLiveResourceGroup) => Promise<void>
): Promise<void> {
  if (!/^[a-z0-9-]{1,24}$/.test(suite)) throw new Error('Invalid Azure test suite name');
  const runId = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(
    0,
    8
  )}`;
  const resourceGroup = `${AZURE_TEST_RESOURCE_PREFIX}${suite}-${runId}`;
  const run: AzureLiveResourceGroup = {
    ...context,
    resourceGroup,
    resourceGroupId: `/subscriptions/${context.subscriptionId}/resourceGroups/${resourceGroup}`,
    nodeResourceGroup: `${resourceGroup}-nodes`,
    location: process.env.AZ_LIVE_LOCATION || 'eastus2',
    runId,
    tags: {
      'aks-desktop-test': 'rest-e2e',
      'aks-desktop-test-run': runId,
      'aks-desktop-test-suite': suite,
      'aks-desktop-test-created-at': new Date().toISOString(),
    },
  };
  const errors: unknown[] = [];
  try {
    console.info(`Azure REST E2E run ${runId}: ${resourceGroup}`);
    await azRequest({
      ...context,
      url: run.resourceGroupId,
      method: 'PUT',
      apiVersion: RESOURCE_API_VERSION,
      body: { location: run.location, tags: run.tags },
    });
    await test(run);
  } catch (error) {
    errors.push(error);
  } finally {
    // AKS creates its node group separately; attempt both even if one deletion fails.
    for (const name of [run.resourceGroup, run.nodeResourceGroup]) {
      try {
        await deleteTestResourceGroup(context, name);
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AzureLiveTestError(errors, resourceGroup);
  }
}

/**
 * @param context - Explicit subscription and credential to inspect without mutation.
 * @returns Prefixed group metadata, each with a resources array of ARM IDs, names
 * and types. Includes AKS node groups even when they lack the test ownership tags.
 * @throws If paged group/resource inventory fails; no success-shaped partial result.
 */
export async function listAzureTestResources(context: AzureLiveContext) {
  const groups = await azListAll<{
    /** Complete ARM group resource ID. */
    id: string;
    /** Group name checked against AZURE_TEST_RESOURCE_PREFIX. */
    name: string;
    /** Azure region assigned to the group. */
    location: string;
    /** Optional ownership/run tags, preserved in the inventory output. */
    tags?: Record<string, string>;
  }>({
    ...context,
    url: `/subscriptions/${context.subscriptionId}/resourcegroups`,
    apiVersion: RESOURCE_API_VERSION,
  });
  const results = [];
  for (const group of groups.filter(group => group.name.startsWith(AZURE_TEST_RESOURCE_PREFIX))) {
    const resources = await azListAll<{
      /** Complete resource ARM ID. */
      id: string;
      /** Azure resource name. */
      name: string;
      /** Provider/resource type, for example Microsoft.ManagedIdentity/userAssignedIdentities. */
      type: string;
    }>({
      ...context,
      url: `/subscriptions/${context.subscriptionId}/resourceGroups/${encodeURIComponent(
        group.name
      )}/resources`,
      apiVersion: RESOURCE_API_VERSION,
    });
    results.push({ ...group, resources });
  }
  return results;
}
