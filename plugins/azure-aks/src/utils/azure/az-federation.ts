// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
// Federated credential functions (GitHub Actions OIDC and K8s service account federation).

import { ContainerServiceClient } from '@azure/arm-containerservice';
import { ManagedServiceIdentityClient } from '@azure/arm-msi';
import { azureCredential } from '../../azureAuth';
import { K8S_DNS_LABEL_PATTERN } from '../kubernetes/k8sNames';
import { debugLog, getErrorMessage, isValidGuid } from './az-helpers';
import { isValidAzResourceName } from './az-validation';

/**
 * Shared helper: creates (or updates) a federated identity credential.
 * `createOrUpdate` is idempotent, so an already-existing credential is not an error.
 */
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

  try {
    debugLog(logPrefix, credentialName);
    const client = new ManagedServiceIdentityClient(azureCredential, subscriptionId);
    await client.federatedIdentityCredentials.createOrUpdate(
      resourceGroup,
      identityName,
      credentialName,
      {
        issuer,
        subject,
        audiences: ['api://AzureADTokenExchange'],
      }
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
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

  let issuerUrl: string | undefined;
  let workloadIdentityEnabled: boolean | undefined;
  try {
    debugLog('Getting AKS OIDC issuer URL and workload identity status:', clusterName);
    const client = new ContainerServiceClient(azureCredential, subscriptionId);
    const cluster = await client.managedClusters.get(resourceGroup, clusterName);
    issuerUrl = cluster.oidcIssuerProfile?.issuerURL;
    workloadIdentityEnabled = cluster.securityProfile?.workloadIdentity?.enabled;
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }

  if (!issuerUrl && !workloadIdentityEnabled) {
    return {
      success: false,
      error:
        'Cluster does not have OIDC issuer or workload identity enabled. Enable both with: az aks update --name <cluster> --resource-group <rg> --enable-oidc-issuer --enable-workload-identity',
    };
  }

  if (!issuerUrl) {
    return {
      success: false,
      error:
        'Cluster does not have OIDC issuer enabled. Enable it with: az aks update --name <cluster> --resource-group <rg> --enable-oidc-issuer',
    };
  }

  if (!workloadIdentityEnabled) {
    return {
      success: false,
      error:
        'Cluster does not have workload identity enabled. Enable it with: az aks update --name <cluster> --resource-group <rg> --enable-workload-identity',
    };
  }

  return { success: true, issuerUrl };
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
