// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { generateKeyPairSync } from 'node:crypto';
import { azRequest, AzureRequestError } from '../azure/az-http';
import type { AzureLiveResourceGroup } from './azureLiveTestUtils';

/**
 * @returns A fresh 2048-bit RSA OpenSSH public key for the disposable cluster.
 * The unused generated private key is not persisted.
 * @throws If key generation/export cannot provide the RSA public components.
 */
function sshPublicKey(): string {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({
    format: 'jwk',
  });
  if (!key.e || !key.n) throw new Error('Unable to generate an AKS test SSH public key');
  /**
   * @param value - OpenSSH record payload.
   * @returns Payload prefixed by its four-byte big-endian length.
   */
  const part = (value: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    return Buffer.concat([length, value]);
  };
  /**
   * @param value - Base64url RSA integer from the public JWK.
   * @returns A length-prefixed positive SSH integer, padded when its sign bit is set.
   */
  const integer = (value: string) => {
    const bytes = Buffer.from(value, 'base64url');
    return part(bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
  };
  return `ssh-rsa ${Buffer.concat([
    part(Buffer.from('ssh-rsa')),
    integer(key.e),
    integer(key.n),
  ]).toString('base64')}`;
}

/**
 * Creates a billable, Entra/RBAC/OIDC-enabled disposable AKS cluster through ARM.
 * @param run - Owned primary/node groups, account, credential, region and tags.
 * @returns The run context plus clusterName=aks after provisioning reaches Succeeded.
 * @throws On rejected writes, terminal provisioning failures or a 20-minute poll budget.
 * Uses one Standard_D2as_v6 node unless AZ_LIVE_AKS_VM_SIZE overrides it. The caller's
 * withAzureTestResourceGroup/finally lifecycle must delete both groups on every outcome.
 */
export async function createLiveAksCluster(run: AzureLiveResourceGroup) {
  const clusterName = 'aks';
  const url = `${run.resourceGroupId}/providers/Microsoft.ContainerService/managedClusters/${clusterName}`;
  const request = { ...run, url, apiVersion: '2026-01-01' };
  const deadline = Date.now() + 20 * 60_000;
  await azRequest({
    ...request,
    method: 'PUT',
    body: {
      location: run.location,
      tags: run.tags,
      identity: { type: 'SystemAssigned' },
      sku: { name: 'Base', tier: 'Free' },
      properties: {
        dnsPrefix: `aksd-${run.runId}`,
        nodeResourceGroup: run.nodeResourceGroup,
        enableRBAC: true,
        aadProfile: { managed: true, enableAzureRBAC: true, tenantID: run.tenantId },
        oidcIssuerProfile: { enabled: true },
        securityProfile: { workloadIdentity: { enabled: true } },
        linuxProfile: {
          adminUsername: 'azureuser',
          ssh: { publicKeys: [{ keyData: sshPublicKey() }] },
        },
        agentPoolProfiles: [
          {
            name: 'system',
            mode: 'System',
            count: 1,
            vmSize: process.env.AZ_LIVE_AKS_VM_SIZE || 'Standard_D2as_v6',
            osType: 'Linux',
            osDiskSizeGB: 32,
            type: 'VirtualMachineScaleSets',
          },
        ],
        networkProfile: {
          networkPlugin: 'azure',
          networkPluginMode: 'overlay',
          loadBalancerSku: 'standard',
          outboundType: 'loadBalancer',
        },
      },
    },
  });
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    try {
      const cluster = await azRequest<{
        properties?: {
          provisioningState?: string;
          status?: { provisioningError?: { message?: string } };
        };
      }>({ ...request, timeoutMs: Math.min(60_000, Math.max(1, deadline - Date.now())) });
      const state = cluster?.properties?.provisioningState;
      if (state === 'Succeeded') return { ...run, clusterName };
      if (state && ['Failed', 'Canceled', 'Cancelled'].includes(state)) {
        throw new Error(
          `Test AKS creation ${state}: ${
            cluster?.properties?.status?.provisioningError?.message ??
            'see ARM deployment diagnostics'
          }`
        );
      }
    } catch (error) {
      if (
        !(
          error instanceof AzureRequestError &&
          error.status === 404 &&
          error.code === 'ResourceNotFound'
        )
      ) {
        throw error;
      }
    }
  }
  throw new Error(`Timed out creating test AKS cluster in ${run.resourceGroup}`);
}
