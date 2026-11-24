// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AzureRequestError } from './az-http';

const mocks = vi.hoisted(() => ({
  azRequest: vi.fn(),
  getAzureCloudEndpoints: vi.fn(),
  getSubscriptionCredential: vi.fn(),
  getManagedClusterDetails: vi.fn(),
}));

vi.mock('./az-http', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-http')>()),
  azRequest: (...args: unknown[]) => mocks.azRequest(...args),
}));
vi.mock('./az-cloud', () => ({
  getAzureCloudEndpoints: (...args: unknown[]) => mocks.getAzureCloudEndpoints(...args),
}));
vi.mock('./az-token', async importOriginal => ({
  ...(await importOriginal<typeof import('./az-token')>()),
  getSubscriptionCredential: (...args: unknown[]) => mocks.getSubscriptionCredential(...args),
}));
vi.mock('./az-managed-clusters', () => ({
  getManagedClusterDetails: (...args: unknown[]) => mocks.getManagedClusterDetails(...args),
}));

import {
  createFederatedCredential,
  createK8sFederatedCredential,
  getAksOidcIssuerUrl,
} from './az-federation';

const subscriptionId = '11111111-2222-3333-4444-555555555555';
const resourceGroup = 'my-rg';
const identityName = 'my-identity';
const subCredential = { getToken: vi.fn() };
const cloud = {
  endpoint: 'https://management.usgovcloudapi.net',
  scope: 'https://management.usgovcloudapi.net/.default',
};

const githubOptions = {
  subscriptionId,
  resourceGroup,
  identityName,
  repoOwner: 'octo',
  repoName: 'my.app',
  branch: 'main',
};

const k8sOptions = {
  subscriptionId,
  resourceGroup,
  identityName,
  issuerUrl: 'https://oidc.prod-aks.azure.com/tenant/cluster/',
  namespace: 'app-ns',
  serviceAccountName: 'app-sa',
};

function credentialUrl(name: string) {
  return (
    `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${identityName}` +
    `/federatedIdentityCredentials/${name}`
  );
}

describe('federated identity credential REST creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAzureCloudEndpoints.mockResolvedValue(cloud);
    mocks.getSubscriptionCredential.mockReturnValue(subCredential);
  });

  it('creates a GitHub federated credential via GET-then-PUT on 404', async () => {
    mocks.azRequest
      .mockRejectedValueOnce(new AzureRequestError('Not found', { status: 404 }))
      .mockResolvedValueOnce({});

    await expect(createFederatedCredential(githubOptions)).resolves.toEqual({ success: true });

    expect(mocks.getSubscriptionCredential).toHaveBeenCalledWith(subscriptionId);
    expect(mocks.azRequest).toHaveBeenCalledTimes(2);
    expect(mocks.azRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'GET',
        url: credentialUrl('GitHubActions-my-app'),
        apiVersion: '2023-01-31',
        credential: subCredential,
        endpoint: cloud.endpoint,
        scope: cloud.scope,
      })
    );
    expect(mocks.azRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'PUT',
        url: credentialUrl('GitHubActions-my-app'),
        apiVersion: '2023-01-31',
        body: {
          properties: {
            issuer: 'https://token.actions.githubusercontent.com',
            subject: 'repo:octo/my.app:ref:refs/heads/main',
            audiences: ['api://AzureADTokenExchange'],
          },
        },
      })
    );
  });

  it('creates a Kubernetes federated credential via GET-then-PUT on 404', async () => {
    mocks.azRequest
      .mockRejectedValueOnce(new AzureRequestError('Not found', { code: 'ResourceNotFound' }))
      .mockResolvedValueOnce({});

    await expect(createK8sFederatedCredential(k8sOptions)).resolves.toEqual({ success: true });

    expect(mocks.azRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'PUT',
        url: credentialUrl('K8sSA-app-ns-app-sa'),
        apiVersion: '2023-01-31',
        body: {
          properties: {
            issuer: k8sOptions.issuerUrl,
            subject: 'system:serviceaccount:app-ns:app-sa',
            audiences: ['api://AzureADTokenExchange'],
          },
        },
      })
    );
  });

  it('succeeds on identical retry without calling PUT', async () => {
    mocks.azRequest.mockResolvedValueOnce({
      properties: {
        issuer: 'https://token.actions.githubusercontent.com',
        subject: 'repo:octo/my.app:ref:refs/heads/main',
        audiences: ['api://AzureADTokenExchange'],
      },
    });

    await expect(createFederatedCredential(githubOptions)).resolves.toEqual({ success: true });
    expect(mocks.azRequest).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: 'different issuer',
      properties: {
        issuer: 'https://other.example.com',
        subject: 'repo:octo/my.app:ref:refs/heads/main',
        audiences: ['api://AzureADTokenExchange'],
      },
    },
    {
      name: 'different subject',
      properties: {
        issuer: 'https://token.actions.githubusercontent.com',
        subject: 'repo:octo/other:ref:refs/heads/main',
        audiences: ['api://AzureADTokenExchange'],
      },
    },
    {
      name: 'different audiences',
      properties: {
        issuer: 'https://token.actions.githubusercontent.com',
        subject: 'repo:octo/my.app:ref:refs/heads/main',
        audiences: ['api://OtherAudience'],
      },
    },
  ])('refuses to overwrite conflicting trust settings ($name)', async ({ properties }) => {
    mocks.azRequest.mockResolvedValueOnce({ properties });

    const result = await createFederatedCredential(githubOptions);
    expect(result.success).toBe(false);
    expect(result.error).toContain('conflicting trust settings');
    expect(mocks.azRequest).toHaveBeenCalledOnce();
  });

  it('truncates long Kubernetes credential names to the 120-character ARM limit', async () => {
    mocks.azRequest
      .mockRejectedValueOnce(new AzureRequestError('Not found', { status: 404 }))
      .mockResolvedValueOnce({});

    const namespace = 'a'.repeat(63);
    const serviceAccountName = 'b'.repeat(63);
    await expect(
      createK8sFederatedCredential({ ...k8sOptions, namespace, serviceAccountName })
    ).resolves.toEqual({ success: true });

    const url = mocks.azRequest.mock.calls[0][0].url as string;
    const name = url.split('/').pop()!;
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,119}$/);
  });

  it('accepts maximum-length GitHub repository names within the 120-character ARM limit', async () => {
    mocks.azRequest
      .mockRejectedValueOnce(new AzureRequestError('Not found', { status: 404 }))
      .mockResolvedValueOnce({});

    await expect(
      createFederatedCredential({
        ...githubOptions,
        repoName: 'r'.repeat(100),
      })
    ).resolves.toEqual({ success: true });
    const url = mocks.azRequest.mock.calls[0][0].url as string;
    const name = url.split('/').pop()!;
    expect(name).toHaveLength(114);
  });

  it('returns authorization errors on GET without attempting PUT', async () => {
    mocks.azRequest.mockRejectedValueOnce(
      new AzureRequestError('AuthorizationFailed', { status: 403 })
    );

    const result = await createFederatedCredential(githubOptions);
    expect(result).toEqual({ success: false, error: 'AuthorizationFailed' });
    expect(mocks.azRequest).toHaveBeenCalledOnce();
  });

  it('returns authorization errors on PUT', async () => {
    mocks.azRequest
      .mockRejectedValueOnce(new AzureRequestError('Not found', { status: 404 }))
      .mockRejectedValueOnce(new AzureRequestError('Write forbidden', { status: 403 }));

    const result = await createK8sFederatedCredential(k8sOptions);
    expect(result).toEqual({ success: false, error: 'Write forbidden' });
    expect(mocks.azRequest).toHaveBeenCalledTimes(2);
  });

  it('rejects non-HTTPS issuer URLs before HTTP', async () => {
    const result = await createK8sFederatedCredential({
      ...k8sOptions,
      issuerUrl: 'http://insecure.example.com',
    });
    expect(result).toEqual({ success: false, error: 'OIDC issuer URL must use HTTPS' });
    expect(mocks.azRequest).not.toHaveBeenCalled();
  });

  it('serializes concurrent GET/PUT per credential so a conflicting caller does not overwrite the first', async () => {
    let releaseFirstGet!: () => void;
    const firstGetGate = new Promise<void>(resolve => {
      releaseFirstGet = resolve;
    });
    let stored: unknown;
    let putCount = 0;

    mocks.azRequest.mockImplementation(
      async (req: { method: string; body?: { properties: unknown } }) => {
        if (req.method === 'GET') {
          if (!stored) {
            await firstGetGate;
            if (!stored) throw new AzureRequestError('Not found', { status: 404 });
          }
          return { properties: stored };
        }
        putCount++;
        stored = req.body?.properties;
        return {};
      }
    );

    const first = createFederatedCredential(githubOptions);
    const second = createFederatedCredential({ ...githubOptions, branch: 'develop' });
    releaseFirstGet();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({ success: true });
    expect(secondResult.success).toBe(false);
    expect(secondResult.error).toContain('conflicting trust settings');
    expect(putCount).toBe(1);
  });

  it('settles an aborted queued caller immediately without starting its request after the predecessor finishes', async () => {
    let releaseFirstGet!: () => void;
    const firstGetGate = new Promise<void>(resolve => {
      releaseFirstGet = resolve;
    });
    let calls = 0;

    mocks.azRequest.mockImplementation(async (req: { method: string }) => {
      calls++;
      if (req.method === 'GET') {
        await firstGetGate;
        throw new AzureRequestError('Not found', { status: 404 });
      }
      return {};
    });

    const controller = new AbortController();
    const first = createFederatedCredential(githubOptions);
    const second = createFederatedCredential({ ...githubOptions, signal: controller.signal });

    controller.abort(new Error('Queued caller cancelled'));
    await expect(second).resolves.toEqual({ success: false, error: 'Queued caller cancelled' });

    releaseFirstGet();
    await expect(first).resolves.toEqual({ success: true });
    expect(calls).toBe(2);
  });

  it.each(['team.prod', 'rg(test)', 'équipe_资源١', '-rg'])(
    'accepts valid Azure resource group %s for GitHub, K8s, and OIDC calls',
    async resourceGroup => {
      mocks.azRequest
        .mockRejectedValueOnce(new AzureRequestError('Not found', { status: 404 }))
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new AzureRequestError('Not found', { status: 404 }))
        .mockResolvedValueOnce({});
      mocks.getManagedClusterDetails.mockResolvedValueOnce({
        properties: {
          oidcIssuerProfile: { issuerURL: 'https://issuer.example.com' },
          securityProfile: { workloadIdentity: { enabled: true } },
        },
      });

      await expect(createFederatedCredential({ ...githubOptions, resourceGroup })).resolves.toEqual(
        {
          success: true,
        }
      );
      await expect(createK8sFederatedCredential({ ...k8sOptions, resourceGroup })).resolves.toEqual(
        {
          success: true,
        }
      );
      await expect(
        getAksOidcIssuerUrl({
          clusterName: 'my-cluster',
          resourceGroup,
          subscriptionId: githubOptions.subscriptionId,
        })
      ).resolves.toEqual({ success: true, issuerUrl: 'https://issuer.example.com' });
    }
  );

  it('accepts hierarchical branch names such as release/deploy and rejects unsafe branches', async () => {
    mocks.azRequest
      .mockRejectedValueOnce(new AzureRequestError('Not found', { status: 404 }))
      .mockResolvedValueOnce({});

    await expect(
      createFederatedCredential({ ...githubOptions, branch: 'release/deploy' })
    ).resolves.toEqual({ success: true });
    expect(mocks.azRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({
          properties: expect.objectContaining({
            subject: 'repo:octo/my.app:ref:refs/heads/release/deploy',
          }),
        }),
      })
    );

    for (const unsafeBranch of ['../evil', 'release//deploy', 'main.lock']) {
      await expect(
        createFederatedCredential({ ...githubOptions, branch: unsafeBranch })
      ).resolves.toMatchObject({ success: false });
    }
  });
});
