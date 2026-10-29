// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { getAzureCloudEndpoints } from './az-cloud';
import { azRequest } from './az-http';
import { registerContainerServiceProvider } from './az-resource-providers';
import { ARM_SCOPE, getSubscriptionCredential } from './az-token';

/**
 * Inspects identity/audience claims only after the real ARM service accepted a token.
 * @param token - In-memory access token; never written to disk or logged.
 * @returns The aud (resource), tid (tenant GUID), and oid (principal GUID) claims.
 * @throws For a malformed JWT payload; this is a test assertion aid, not token validation.
 */
function tokenClaims(token: string): { aud?: unknown; tid?: unknown; oid?: unknown } {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('ARM access token has no JWT payload');
  try {
    const claims: { aud?: unknown; tid?: unknown; oid?: unknown } = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
      throw new Error('JWT payload is not an object');
    }
    return claims;
  } catch {
    throw new Error('ARM access token has an invalid JWT payload');
  }
}

describe.runIf(azureLiveEnabled)(
  'resource-provider REST E2E',
  {
    timeout: AZURE_LIVE_TEST_TIMEOUT,
  },
  () => {
    let context: ReturnType<typeof getLiveAzureContext>;
    const command = vi.fn(() => {
      throw new Error('Resource operations must not execute Azure CLI');
    });

    beforeAll(() => {
      context = getLiveAzureContext();
      vi.stubGlobal('pluginRunCommand', command);
    }, 70_000);
    afterAll(() => vi.unstubAllGlobals());

    test('accepts repeated registration on the selected subscription and observes its state', async () => {
      await withAzureTestResourceGroup('provider', context, async run => {
        for (let attempt = 0; attempt < 2; attempt++) {
          expect(await registerContainerServiceProvider(run.subscriptionId, run)).toMatchObject({
            success: true,
          });
        }
        const provider = await azRequest<{ namespace: string; registrationState: string }>({
          ...run,
          url: `/subscriptions/${run.subscriptionId}/providers/Microsoft.ContainerService`,
          apiVersion: '2021-04-01',
        });
        expect(provider?.namespace).toBe('Microsoft.ContainerService');
        expect(['Registered', 'Registering']).toContain(provider?.registrationState);
        expect(command).not.toHaveBeenCalled();
      });
    });

    test('deletes the run group after a failing assertion', async () => {
      const failure = new Error('intentional E2E assertion failure');
      let resourceGroupId = '';
      await expect(
        withAzureTestResourceGroup('provider-failure', context, async run => {
          resourceGroupId = run.resourceGroupId;
          throw failure;
        })
      ).rejects.toBe(failure);
      await expect(
        azRequest({
          ...context,
          url: resourceGroupId,
          apiVersion: '2021-04-01',
        })
      ).rejects.toMatchObject({ status: 404, code: 'ResourceGroupNotFound' });
      expect(command).not.toHaveBeenCalled();
    });

    test('uses the real subscription-bound account and configured public-cloud audience without injected credentials', async () => {
      let tokenRequests = 0;
      let cloudReads = 0;
      /**
       * @param executable - Production helper's resolved az executable.
       * @param args - Authentication/configuration arguments, never resource commands.
       * @returns A real child process replacing only Electron's native command bridge.
       */
      const bridge = (executable: string, args: string[]) => {
        if (!['az', 'az.cmd'].includes(basename(executable).toLowerCase())) {
          throw new Error('Only Azure authentication/configuration commands are permitted');
        }
        if (args[0] === 'account' && args[1] === 'get-access-token') {
          expect(args[args.indexOf('--subscription') + 1]).toBe(context.subscriptionId);
          expect(args).not.toContain('--tenant');
          tokenRequests++;
        } else if (args[0] === 'cloud' && args[1] === 'show') {
          expect(args[args.indexOf('--name') + 1]).toBe('AzureCloud');
          cloudReads++;
        } else {
          throw new Error('Resource-specific Azure CLI commands are forbidden in REST E2E tests');
        }
        const child = spawn(executable, args, { shell: process.platform === 'win32' });
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        return child;
      };
      vi.stubGlobal('pluginRunCommand', bridge);
      try {
        await withAzureTestResourceGroup('provider-account', context, async run => {
          const cloud = await getAzureCloudEndpoints('AzureCloud');
          expect(cloud.endpoint).toBe('https://management.azure.com');
          const selected = getSubscriptionCredential(run.subscriptionId);
          selected.clearCache();
          for (let attempt = 0; attempt < 2; attempt++) {
            const result = await registerContainerServiceProvider(run.subscriptionId, {
              tenantId: run.tenantId,
              cloudName: 'AzureCloud',
            });
            expect(result.error).toBeUndefined();
            expect(result.success).toBe(true);
            expect(['Registered', 'Registering']).toContain(result.registrationState);
          }
          const token = await selected.getToken(cloud.scope, { tenantId: run.tenantId });
          const expected = await context.credential.getToken(ARM_SCOPE);
          if (!expected) throw new Error('Selected-account bootstrap returned no token');
          const actualClaims = tokenClaims(token.token);
          const expectedClaims = tokenClaims(expected.token);
          expect(typeof actualClaims.oid).toBe('string');
          expect(actualClaims.oid).toBe(expectedClaims.oid);
          expect(actualClaims.tid).toBe(run.tenantId);
          expect(actualClaims.aud).toBe(cloud.scope.slice(0, -'/.default'.length));
          expect(tokenRequests).toBe(1);
          expect(cloudReads).toBe(1);
          const provider = await azRequest<{ namespace: string; registrationState: string }>({
            ...run,
            url: `/subscriptions/${run.subscriptionId}/providers/Microsoft.ContainerService`,
            apiVersion: '2021-04-01',
          });
          expect(provider?.namespace).toBe('Microsoft.ContainerService');
          expect(['Registered', 'Registering']).toContain(provider?.registrationState);
        });
      } finally {
        vi.stubGlobal('pluginRunCommand', command);
      }
    });
  }
);
