// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
// Federated credential CLI functions (GitHub Actions OIDC and K8s service account federation).

import { K8S_DNS_LABEL_PATTERN } from '../kubernetes/k8sNames';
import {
  debugLog,
  isValidAzResourceName,
  isValidGitHubName,
  isValidGuid,
  runAzCommand,
} from './az-cli';

/** Shared helper: runs `az identity federated-credential create` with dedup handling. */
async function runFederatedCredentialCreate(options: {
  identityName: string;
  resourceGroup: string;
  subscriptionId: string;
  credentialName: string;
  issuer: string;
  subject: string;
  logPrefix: string;
}): Promise<{ success: boolean; error?: string }> {
  const {
    identityName,
    resourceGroup,
    subscriptionId,
    credentialName,
    issuer,
    subject,
    logPrefix,
  } = options;

  const result = await runAzCommand(
    [
      'identity',
      'federated-credential',
      'create',
      '--identity-name',
      identityName,
      '--resource-group',
      resourceGroup,
      '--subscription',
      subscriptionId,
      '--name',
      credentialName,
      '--issuer',
      issuer,
      '--subject',
      subject,
      '--audiences',
      'api://AzureADTokenExchange',
      '--output',
      'json',
    ],
    logPrefix,
    `create federated credential (${credentialName})`,
    undefined,
    stderr => {
      if (stderr.includes('FederatedIdentityCredentialAlreadyExists')) {
        debugLog('Federated credential already exists, continuing.');
        return { success: true };
      }
      return null;
    }
  );

  return { success: result.success, error: result.error };
}

export async function createFederatedCredential(options: {
  identityName: string;
  resourceGroup: string;
  subscriptionId: string;
  repoOwner: string;
  repoName: string;
  branch: string;
}): Promise<{ success: boolean; error?: string }> {
  const { identityName, resourceGroup, subscriptionId, repoOwner, repoName, branch } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(identityName) || !isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid identity name or resource group format' };
  }
  if (!isValidGitHubName(repoOwner) || !isValidGitHubName(repoName) || !isValidGitHubName(branch)) {
    return { success: false, error: 'Invalid GitHub owner, repo name, or branch format' };
  }

  const subject = `repo:${repoOwner}/${repoName}:ref:refs/heads/${branch}`;
  const sanitizedRepoName = repoName.replace(/\./g, '-');
  const credentialName = `GitHubActions-${sanitizedRepoName}`;
  if (!isValidAzResourceName(credentialName)) {
    return { success: false, error: 'Invalid federated credential name format' };
  }

  return runFederatedCredentialCreate({
    identityName,
    resourceGroup,
    subscriptionId,
    credentialName,
    issuer: 'https://token.actions.githubusercontent.com',
    subject,
    logPrefix: 'Creating federated credential:',
  });
}

export async function getAksOidcIssuerUrl(options: {
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
}): Promise<{ success: boolean; issuerUrl?: string; error?: string }> {
  const { clusterName, resourceGroup, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(clusterName) || !isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid cluster name or resource group format' };
  }

  const query =
    '{issuerUrl: oidcIssuerProfile.issuerUrl, workloadIdentityEnabled: securityProfile.workloadIdentity.enabled}';

  const result = await runAzCommand(
    [
      'aks',
      'show',
      '--name',
      clusterName,
      '--resource-group',
      resourceGroup,
      '--subscription',
      subscriptionId,
      '--query',
      query,
      '-o',
      'json',
    ],
    'Getting AKS OIDC issuer URL and workload identity status:',
    'get AKS OIDC issuer URL',
    stdout => {
      let parsed;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch (e) {
        throw new Error(
          `Unexpected output from AKS OIDC issuer query: ${e instanceof Error ? e.message : e}`
        );
      }
      const issuerUrl = parsed.issuerUrl;
      const workloadIdentityEnabled = parsed.workloadIdentityEnabled;

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

      return issuerUrl as string;
    }
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, issuerUrl: result.data };
}

/** Simple 32-bit hash for generating short deterministic suffixes. */
function hashCode(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export async function createK8sFederatedCredential(options: {
  identityName: string;
  resourceGroup: string;
  subscriptionId: string;
  issuerUrl: string;
  namespace: string;
  serviceAccountName: string;
}): Promise<{ success: boolean; error?: string }> {
  const { identityName, resourceGroup, subscriptionId, issuerUrl, namespace, serviceAccountName } =
    options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(identityName) || !isValidAzResourceName(resourceGroup)) {
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
  if (credentialName.length > 128) {
    const suffix = `-${hashCode(rawCredentialName).toString(36)}`;
    credentialName = rawCredentialName.slice(0, 128 - suffix.length).replace(/-$/, '') + suffix;
  }
  if (!isValidAzResourceName(credentialName)) {
    return { success: false, error: 'Invalid federated credential name format' };
  }

  return runFederatedCredentialCreate({
    identityName,
    resourceGroup,
    subscriptionId,
    credentialName,
    issuer: issuerUrl,
    subject,
    logPrefix: 'Creating K8s federated credential:',
  });
}
