// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { type AzureLiveAuthBridge, createAzureLiveAuthBridge } from '../test/azureLiveAuthBridge';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { getAzureCloudEndpoints } from './az-cloud';
import { createFederatedCredential, createK8sFederatedCredential } from './az-federation';
import { azRequest } from './az-http';
import { createManagedIdentity } from './az-managed-identities';
import { getSubscriptionCredential } from './az-token';

interface FederatedCredentialResource {
  name?: string;
  properties?: {
    issuer?: string;
    subject?: string;
    audiences?: string[];
  };
}

describe.runIf(azureLiveEnabled)(
  'federated identity credential REST E2E',
  { timeout: AZURE_LIVE_TEST_TIMEOUT },
  () => {
    let context: ReturnType<typeof getLiveAzureContext>;
    let bridge: AzureLiveAuthBridge;

    beforeAll(async () => {
      context = getLiveAzureContext();
      bridge = createAzureLiveAuthBridge(context.subscriptionId);
      vi.stubGlobal('pluginRunCommand', bridge.runCommand);
      getSubscriptionCredential(context.subscriptionId).clearCache();
      expect((await getAzureCloudEndpoints()).endpoint).toBe('https://management.azure.com');
    }, 70_000);

    afterAll(() => vi.unstubAllGlobals());

    test('creates, retries idempotently, rejects conflicts, and enforces the 120-char ARM name limit', async () => {
      await withAzureTestResourceGroup('federated-credential', context, async run => {
        const identityName = 'fed-id';
        const identity = await createManagedIdentity({
          resourceGroup: run.resourceGroup,
          subscriptionId: run.subscriptionId,
          identityName,
        });
        expect(identity.success).toBe(true);

        const baseCredsUrl =
          `${run.resourceGroupId}/providers/Microsoft.ManagedIdentity` +
          `/userAssignedIdentities/${identityName}/federatedIdentityCredentials`;

        // 1. GitHub federated credential: create, verify via ARM GET, and idempotent retry
        const ghOpts = {
          identityName,
          resourceGroup: run.resourceGroup,
          subscriptionId: run.subscriptionId,
          repoOwner: 'Azure',
          repoName: 'aks.desktop-live',
          branch: 'main',
        };
        await expect(createFederatedCredential(ghOpts)).resolves.toEqual({ success: true });
        await expect(createFederatedCredential(ghOpts)).resolves.toEqual({ success: true });

        const ghCred = await azRequest<FederatedCredentialResource>({
          ...run,
          url: `${baseCredsUrl}/GitHubActions-aks-desktop-live`,
          apiVersion: '2023-01-31',
        });
        expect(ghCred?.properties).toEqual({
          issuer: 'https://token.actions.githubusercontent.com',
          subject: 'repo:Azure/aks.desktop-live:ref:refs/heads/main',
          audiences: ['api://AzureADTokenExchange'],
        });

        // 2. Conflicting trust settings fail without overwriting the existing credential
        const conflict = await createFederatedCredential({ ...ghOpts, branch: 'release' });
        expect(conflict.success).toBe(false);
        expect(conflict.error).toContain('conflicting trust settings');

        const ghCredAfterConflict = await azRequest<FederatedCredentialResource>({
          ...run,
          url: `${baseCredsUrl}/GitHubActions-aks-desktop-live`,
          apiVersion: '2023-01-31',
        });
        expect(ghCredAfterConflict?.properties?.subject).toBe(
          'repo:Azure/aks.desktop-live:ref:refs/heads/main'
        );

        // 3. Long Kubernetes credential names truncate to <= 120 chars and are accepted by ARM
        const longNamespace = 'n'.repeat(63);
        const longServiceAccount = 's'.repeat(63);
        await expect(
          createK8sFederatedCredential({
            identityName,
            resourceGroup: run.resourceGroup,
            subscriptionId: run.subscriptionId,
            issuerUrl: 'https://oidc.prod-aks.azure.com/00000000-0000-0000-0000-000000000000/',
            namespace: longNamespace,
            serviceAccountName: longServiceAccount,
          })
        ).resolves.toEqual({ success: true });

        const list = await azRequest<{ value?: FederatedCredentialResource[] }>({
          ...run,
          url: baseCredsUrl,
          apiVersion: '2023-01-31',
        });
        const k8sCred = list?.value?.find(c => c.name?.startsWith('K8sSA-'));
        expect(k8sCred?.name).toBeDefined();
        expect(k8sCred!.name!.length).toBeLessThanOrEqual(120);
        expect(k8sCred?.properties?.subject).toBe(
          `system:serviceaccount:${longNamespace}:${longServiceAccount}`
        );

        // 4. Non-existent identity surfaces ARM error cleanly
        const missing = await createFederatedCredential({
          ...ghOpts,
          identityName: 'does-not-exist',
        });
        expect(missing.success).toBe(false);
        expect(missing.error).toBeTruthy();
      });
    });
  }
);
