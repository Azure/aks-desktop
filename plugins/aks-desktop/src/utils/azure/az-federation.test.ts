// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunAzCommand = vi.fn();
const mockGetManagedClusterDetails = vi.fn();
vi.mock('./az-managed-clusters', () => ({
  getManagedClusterDetails: (...args: unknown[]) => mockGetManagedClusterDetails(...args),
}));
vi.mock('./az-cli-core', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-cli-core')>()),
  runAzCommand: (...args: unknown[]) => mockRunAzCommand(...args),
}));

import {
  createFederatedCredential,
  createK8sFederatedCredential,
  getAksOidcIssuerUrl,
} from './az-federation';

const options = {
  subscriptionId: '11111111-2222-3333-4444-555555555555',
  identityName: 'custom-identity',
  clusterName: 'cluster',
  repoOwner: 'owner',
  repoName: 'repo',
  branch: 'main',
  issuerUrl: 'https://issuer.example.com',
  namespace: 'namespace',
  serviceAccountName: 'service-account',
};

describe.each([
  ['GitHub federation', createFederatedCredential],
  ['Kubernetes federation', createK8sFederatedCredential],
] as const)('%s resource group validation', (_label, operation) => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['team.prod', 'rg(test)', 'équipe_资源١', '-rg'])(
    'passes resource group %s unchanged to Azure CLI',
    async resourceGroup => {
      mockRunAzCommand.mockResolvedValue({ success: true, data: options.issuerUrl });
      await expect(operation({ ...options, resourceGroup })).resolves.toMatchObject({
        success: true,
      });
      expect(mockRunAzCommand).toHaveBeenCalledTimes(1);
      const args = mockRunAzCommand.mock.calls[0][0];
      expect(args).toContain(`--resource-group=${resourceGroup}`);
      expect(args).not.toContain('--resource-group');
      expect(args).not.toContain(resourceGroup);
    }
  );

  it.each(['rg.', 'rg/name', 'rg\\name', 'a'.repeat(91), "rg'name"])(
    'rejects invalid group %s before CLI calls',
    async resourceGroup => {
      await expect(operation({ ...options, resourceGroup })).resolves.toMatchObject({
        success: false,
      });
      expect(mockRunAzCommand).not.toHaveBeenCalled();
    }
  );

  it('still rejects invalid identity names', async () => {
    await expect(
      operation({
        ...options,
        resourceGroup: 'team.prod',
        identityName: 'identity.invalid',
      })
    ).resolves.toMatchObject({ success: false });
    expect(mockRunAzCommand).not.toHaveBeenCalled();
  });
});

describe('createFederatedCredential branch validation', () => {
  beforeEach(() => vi.resetAllMocks());

  it('accepts hierarchical branch names such as release/deploy', async () => {
    mockRunAzCommand.mockResolvedValue({ success: true });
    await expect(
      createFederatedCredential({
        ...options,
        resourceGroup: 'team.prod',
        branch: 'release/deploy',
      })
    ).resolves.toEqual({ success: true });
    expect(mockRunAzCommand.mock.calls[0][0]).toContain(
      'repo:owner/repo:ref:refs/heads/release/deploy'
    );
  });

  it.each(['../evil', 'release//deploy', 'main.lock'])(
    'rejects unsafe branch %s before CLI calls',
    async branch => {
      await expect(
        createFederatedCredential({
          ...options,
          resourceGroup: 'team.prod',
          branch,
        })
      ).resolves.toMatchObject({ success: false });
      expect(mockRunAzCommand).not.toHaveBeenCalled();
    }
  );
});

describe('AKS OIDC REST resource group validation', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['team.prod', 'rg(test)', 'équipe_资源١', '-rg'])(
    'passes resource group %s unchanged to the shared REST read',
    async resourceGroup => {
      mockGetManagedClusterDetails.mockResolvedValue({
        properties: {
          oidcIssuerProfile: { issuerURL: options.issuerUrl },
          securityProfile: { workloadIdentity: { enabled: true } },
        },
      });
      await expect(getAksOidcIssuerUrl({ ...options, resourceGroup })).resolves.toEqual({
        success: true,
        issuerUrl: options.issuerUrl,
      });
      expect(mockGetManagedClusterDetails).toHaveBeenCalledWith(
        expect.objectContaining({ resourceGroup })
      );
      expect(mockRunAzCommand).not.toHaveBeenCalled();
    }
  );

  it.each(['rg.', 'rg/name', 'rg\\name', 'a'.repeat(91), "rg'name"])(
    'rejects invalid group %s before REST calls',
    async resourceGroup => {
      await expect(getAksOidcIssuerUrl({ ...options, resourceGroup })).resolves.toMatchObject({
        success: false,
      });
      expect(mockGetManagedClusterDetails).not.toHaveBeenCalled();
      expect(mockRunAzCommand).not.toHaveBeenCalled();
    }
  );
});
