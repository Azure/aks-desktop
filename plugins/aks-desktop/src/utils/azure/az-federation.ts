// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
// Federated credential REST functions (GitHub Actions OIDC and K8s service account federation).

import { K8S_DNS_LABEL_PATTERN } from '../kubernetes/k8sNames';
import { getErrorMessage, isValidGuid } from './az-cli-core';
import { getAzureCloudEndpoints } from './az-cloud';
import {
  azRequest,
  type AzRequestOptions,
  AzureRequestError,
  createAzureRequestSignal,
} from './az-http';
import { type AksClusterReadOptions, getManagedClusterDetails } from './az-managed-clusters';
import { getSubscriptionCredential, withAbort } from './az-token';
import {
  isValidAzResourceGroupName,
  isValidAzResourceName,
  isValidGitBranchName,
  isValidGitHubName,
} from './az-validation';

const FEDERATED_CREDENTIALS_API_VERSION = '2023-01-31';
const FEDERATED_CREDENTIAL_AUDIENCE = 'api://AzureADTokenExchange';
// ARM Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials (2023-01-31):
// 3-120 chars, starting with an alphanumeric character, followed by alphanumeric, '-' or '_'.
const FEDERATED_CREDENTIAL_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,119}$/;
const FEDERATED_CREDENTIAL_NAME_MAX_LENGTH = 120;
const inFlightCredentials = new Map<string, Promise<void>>();

function serializeByCredential<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = inFlightCredentials.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  const tail = current.then(
    () => undefined,
    () => undefined
  );
  inFlightCredentials.set(key, tail);
  void tail.finally(() => {
    if (inFlightCredentials.get(key) === tail) {
      inFlightCredentials.delete(key);
    }
  });
  return current;
}

type FederatedCredentialRequestOptions = Pick<
  AzRequestOptions,
  'credential' | 'endpoint' | 'scope' | 'tenantId' | 'signal' | 'timeoutMs'
>;

interface FederatedIdentityCredentialResource {
  properties?: {
    issuer?: unknown;
    subject?: unknown;
    audiences?: unknown;
  };
}

function isResourceNotFound(error: unknown): boolean {
  return (
    error instanceof AzureRequestError &&
    (error.status === 404 || error.code === 'ResourceNotFound')
  );
}

function hasMatchingTrustSettings(
  existing: FederatedIdentityCredentialResource | undefined,
  issuer: string,
  subject: string
): boolean {
  const props = existing?.properties;
  if (!props || typeof props !== 'object') return false;
  if (props.issuer !== issuer || props.subject !== subject) return false;
  return (
    Array.isArray(props.audiences) &&
    props.audiences.length === 1 &&
    props.audiences[0] === FEDERATED_CREDENTIAL_AUDIENCE
  );
}

/**
 * Ensures a federated identity credential via ARM REST (`2023-01-31`).
 * Reads any existing credential first so identical retries succeed without write
 * calls, while conflicting trust settings fail instead of silently overwriting.
 */
async function ensureFederatedCredential(
  options: FederatedCredentialRequestOptions & {
    identityName: string;
    resourceGroup: string;
    subscriptionId: string;
    credentialName: string;
    issuer: string;
    subject: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const { identityName, resourceGroup, subscriptionId, credentialName, issuer, subject } = options;
  const url =
    `/subscriptions/${encodeURIComponent(subscriptionId)}` +
    `/resourceGroups/${encodeURIComponent(resourceGroup)}` +
    `/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${encodeURIComponent(
      identityName
    )}` +
    `/federatedIdentityCredentials/${encodeURIComponent(credentialName)}`;

  const linked = createAzureRequestSignal(options.signal, options.timeoutMs);
  try {
    return await withAbort(
      () =>
        serializeByCredential(url.toLowerCase(), async () => {
          if (linked.signal.aborted) {
            throw linked.signal.reason ?? new AzureRequestError('Request aborted');
          }
          const credential = options.credential ?? getSubscriptionCredential(subscriptionId);
          const cloud =
            !options.credential && (!options.endpoint || !options.scope)
              ? await getAzureCloudEndpoints(undefined, linked.signal)
              : undefined;
          const requestBase = {
            ...options,
            endpoint: options.endpoint ?? cloud?.endpoint,
            scope: options.scope ?? cloud?.scope,
            signal: linked.signal,
            credential,
            url,
            apiVersion: FEDERATED_CREDENTIALS_API_VERSION,
          };

          try {
            const existing = await azRequest<FederatedIdentityCredentialResource>({
              ...requestBase,
              method: 'GET',
            });
            if (hasMatchingTrustSettings(existing, issuer, subject)) {
              return { success: true };
            }
            return {
              success: false,
              error: `Federated credential "${credentialName}" already exists with conflicting trust settings`,
            };
          } catch (error) {
            if (!isResourceNotFound(error)) {
              return { success: false, error: getErrorMessage(error) };
            }
          }

          await azRequest<FederatedIdentityCredentialResource>({
            ...requestBase,
            method: 'PUT',
            body: {
              properties: {
                issuer,
                subject,
                audiences: [FEDERATED_CREDENTIAL_AUDIENCE],
              },
            },
          });
          return { success: true };
        }),
      linked.signal
    );
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  } finally {
    linked.dispose();
  }
}

/**
 * Ensures a GitHub Actions OIDC federated identity credential on a user-assigned managed identity.
 * @param options - Identity coordinates, GitHub repository/branch, and optional REST overrides.
 * @returns Success or an actionable validation, conflict, or ARM error.
 */
export async function createFederatedCredential(
  options: FederatedCredentialRequestOptions & {
    identityName: string;
    resourceGroup: string;
    subscriptionId: string;
    repoOwner: string;
    repoName: string;
    branch: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const { identityName, resourceGroup, subscriptionId, repoOwner, repoName, branch } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(identityName) || !isValidAzResourceGroupName(resourceGroup)) {
    return { success: false, error: 'Invalid identity name or resource group format' };
  }
  if (
    !isValidGitHubName(repoOwner) ||
    !isValidGitHubName(repoName) ||
    !isValidGitBranchName(branch)
  ) {
    return { success: false, error: 'Invalid GitHub owner, repo name, or branch format' };
  }

  const subject = `repo:${repoOwner}/${repoName}:ref:refs/heads/${branch}`;
  const sanitizedRepoName = repoName.replace(/\./g, '-');
  const credentialName = `GitHubActions-${sanitizedRepoName}`;
  if (!FEDERATED_CREDENTIAL_NAME_PATTERN.test(credentialName)) {
    return { success: false, error: 'Invalid federated credential name format' };
  }

  return ensureFederatedCredential({
    ...options,
    identityName,
    resourceGroup,
    subscriptionId,
    credentialName,
    issuer: 'https://token.actions.githubusercontent.com',
    subject,
  });
}

/**
 * Verifies both the OIDC issuer URL and workload identity before returning an issuer.
 * @param options - Managed AKS coordinates and shared REST/authentication overrides.
 * @returns A resolved success/issuerUrl or failure/error result. Missing OIDC,
 * missing workload identity, and both missing produce distinct enablement diagnostics.
 * Read/authentication/cancellation failures are also returned, not thrown.
 */
export async function getAksOidcIssuerUrl(options: AksClusterReadOptions): Promise<{
  /** Whether required federation features and an issuer URL were found. */
  success: boolean;
  /** ARM issuerURL, present only when workload identity is also enabled. */
  issuerUrl?: string;
  /** Invalid-input, lookup or feature-enablement diagnostic. */
  error?: string;
}> {
  const { clusterName, resourceGroup, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(clusterName) || !isValidAzResourceGroupName(resourceGroup)) {
    return { success: false, error: 'Invalid cluster name or resource group format' };
  }

  try {
    const { properties } = await getManagedClusterDetails(options);
    const issuerUrl = properties.oidcIssuerProfile?.issuerURL;
    const workloadIdentityEnabled = properties.securityProfile?.workloadIdentity?.enabled;

    if (!issuerUrl && !workloadIdentityEnabled) {
      throw new Error(
        'Cluster does not have OIDC issuer or workload identity enabled. Enable both with: az aks update --name <cluster> --resource-group <rg> --enable-oidc-issuer --enable-workload-identity'
      );
    }

    if (!issuerUrl) {
      throw new Error(
        'Cluster does not have OIDC issuer enabled. Enable it with: az aks update --name <cluster> --resource-group <rg> --enable-oidc-issuer'
      );
    }

    if (!workloadIdentityEnabled) {
      throw new Error(
        'Cluster does not have workload identity enabled. Enable it with: az aks update --name <cluster> --resource-group <rg> --enable-workload-identity'
      );
    }

    return { success: true, issuerUrl };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

/** Simple 32-bit hash for generating short deterministic suffixes. */
function hashCode(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/**
 * Ensures a Kubernetes service-account OIDC federated identity credential on a user-assigned managed identity.
 * Truncates long deterministic credential names to ARM's 120-character limit with a hash suffix.
 * @param options - Identity coordinates, AKS OIDC issuer URL, K8s subject, and optional REST overrides.
 * @returns Success or an actionable validation, conflict, or ARM error.
 */
export async function createK8sFederatedCredential(
  options: FederatedCredentialRequestOptions & {
    identityName: string;
    resourceGroup: string;
    subscriptionId: string;
    issuerUrl: string;
    namespace: string;
    serviceAccountName: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const { identityName, resourceGroup, subscriptionId, issuerUrl, namespace, serviceAccountName } =
    options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(identityName) || !isValidAzResourceGroupName(resourceGroup)) {
    return { success: false, error: 'Invalid identity name or resource group format' };
  }

  // Validate issuerUrl is a well-formed HTTPS URL
  try {
    const parsed = new URL(issuerUrl);
    if (parsed.protocol !== 'https:') {
      return { success: false, error: 'OIDC issuer URL must use HTTPS' };
    }
  } catch {
    return { success: false, error: 'Invalid OIDC issuer URL format' };
  }

  // Validate namespace and serviceAccountName (DNS label: lowercase alphanumeric and hyphens, max 63 chars)
  if (!K8S_DNS_LABEL_PATTERN.test(namespace)) {
    return { success: false, error: 'Invalid Kubernetes namespace format' };
  }
  if (!K8S_DNS_LABEL_PATTERN.test(serviceAccountName)) {
    return { success: false, error: 'Invalid Kubernetes service account name format' };
  }

  const subject = `system:serviceaccount:${namespace}:${serviceAccountName}`;
  const rawCredentialName = `K8sSA-${namespace}-${serviceAccountName}`;
  let credentialName = rawCredentialName;
  if (credentialName.length > FEDERATED_CREDENTIAL_NAME_MAX_LENGTH) {
    const suffix = `-${hashCode(rawCredentialName).toString(36)}`;
    credentialName =
      rawCredentialName
        .slice(0, FEDERATED_CREDENTIAL_NAME_MAX_LENGTH - suffix.length)
        .replace(/-$/, '') + suffix;
  }
  if (!FEDERATED_CREDENTIAL_NAME_PATTERN.test(credentialName)) {
    return { success: false, error: 'Invalid federated credential name format' };
  }

  return ensureFederatedCredential({
    ...options,
    identityName,
    resourceGroup,
    subscriptionId,
    credentialName,
    issuer: issuerUrl,
    subject,
  });
}
