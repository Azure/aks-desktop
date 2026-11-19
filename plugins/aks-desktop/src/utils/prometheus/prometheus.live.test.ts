// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { getAzureCloudEndpoints } from '../azure/az-cloud';
import { azRequest } from '../azure/az-http';
import { getSubscriptionCredential } from '../azure/az-token';
import { type AzureLiveAuthBridge, createAzureLiveAuthBridge } from '../test/azureLiveAuthBridge';
import {
  AZURE_LIVE_TEST_TIMEOUT,
  azureLiveEnabled,
  getLiveAzureContext,
  withAzureTestResourceGroup,
} from '../test/azureLiveTestUtils';
import { getPrometheusEndpoint } from './getPrometheusEndpoint';
import { queryPrometheus } from './queryPrometheus';

const PROMETHEUS_SCOPE = 'https://prometheus.monitor.azure.com/.default';

describe.runIf(azureLiveEnabled)(
  'Prometheus REST E2E',
  { timeout: AZURE_LIVE_TEST_TIMEOUT },
  () => {
    let context: ReturnType<typeof getLiveAzureContext>;
    let bridge: AzureLiveAuthBridge;

    beforeAll(async () => {
      context = getLiveAzureContext();
      bridge = createAzureLiveAuthBridge(context.subscriptionId);
      vi.stubGlobal('pluginRunCommand', bridge.runCommand);
      getSubscriptionCredential(context.subscriptionId).clearCache();
      const cloud = await getAzureCloudEndpoints();
      expect(cloud.endpoint).toBe('https://management.azure.com');
    }, 70_000);

    afterAll(() => {
      vi.unstubAllGlobals();
    });

    test('discovers workspace endpoint via ARM, acquires Prometheus token, and queries PromQL', async () => {
      await withAzureTestResourceGroup('prometheus', context, async run => {
        await expect(
          getPrometheusEndpoint(run.resourceGroup, 'missing-cluster', run.subscriptionId)
        ).rejects.toThrow('Azure Monitor Metrics');

        const suffix = run.runId.slice(-8);
        const clusterName = `aksd-prom-${suffix}`;
        const workspaceId = `${run.resourceGroupId}/providers/Microsoft.Monitor/accounts/ws-${suffix}`;
        let workspace = await azRequest<{
          properties?: {
            provisioningState?: string;
            metrics?: { prometheusQueryEndpoint?: string };
          };
        }>({
          ...run,
          url: workspaceId,
          method: 'PUT',
          apiVersion: '2023-04-03',
          body: { location: run.location, tags: run.tags, properties: {} },
        });
        const readyBy = Date.now() + 2 * 60_000;
        while (workspace?.properties?.provisioningState !== 'Succeeded') {
          if (Date.now() >= readyBy) {
            throw new Error('Azure Monitor workspace did not finish provisioning in time');
          }
          await new Promise(resolve => setTimeout(resolve, 3000));
          workspace = await azRequest({
            ...run,
            url: workspaceId,
            apiVersion: '2023-04-03',
          });
        }
        const expectedEndpoint = workspace?.properties?.metrics?.prometheusQueryEndpoint
          ?.trim()
          .replace(/\/+$/, '');
        expect(expectedEndpoint).toMatch(/^https:\/\//);

        const ruleGroupId = `${run.resourceGroupId}/providers/Microsoft.AlertsManagement/prometheusRuleGroups/rg-${suffix}`;
        await azRequest({
          ...run,
          url: ruleGroupId,
          method: 'PUT',
          apiVersion: '2023-03-01',
          body: {
            location: run.location,
            tags: run.tags,
            properties: {
              clusterName,
              scopes: [workspaceId],
              interval: 'PT1M',
              rules: [{ record: 'aksd:live_test:up', expression: 'up' }],
            },
          },
        });

        const discoveredEndpoint = await getPrometheusEndpoint(
          run.resourceGroup,
          clusterName,
          run.subscriptionId
        );
        expect(discoveredEndpoint).toBe(expectedEndpoint);

        await expect(
          getPrometheusEndpoint(run.resourceGroup, 'unconfigured-cluster', run.subscriptionId)
        ).rejects.toThrow("No Prometheus workspace found for cluster 'unconfigured-cluster'");

        const token = await getSubscriptionCredential(run.subscriptionId).getToken(
          PROMETHEUS_SCOPE
        );
        expect(token.token).toBeTruthy();
        expect(token.expiresOnTimestamp).toBeGreaterThan(Date.now());

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const queryReadyBy = Date.now() + 3 * 60_000;
          let results: unknown[] = [];
          for (;;) {
            errorSpy.mockClear();
            const end = Math.floor(Date.now() / 1000);
            results = await queryPrometheus(
              discoveredEndpoint,
              'up',
              end - 300,
              end,
              60,
              run.subscriptionId
            );
            if (errorSpy.mock.calls.length === 0) break;
            if (Date.now() >= queryReadyBy) {
              throw new Error(
                `Prometheus query did not succeed before deadline: ${String(
                  errorSpy.mock.calls[0]?.[1]
                )}`
              );
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          expect(Array.isArray(results)).toBe(true);
        } finally {
          errorSpy.mockRestore();
        }

        expect(bridge.tokenRequests).toBe(2);
        expect(bridge.cloudReads).toBe(1);
      });
    });
  }
);
