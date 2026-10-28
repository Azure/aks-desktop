// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { z } from 'zod';
import {
  API_VERSION,
  Cluster,
  ClusterInventory,
  GenerateRequest,
  Insight,
  insightSchema,
  InsightsProvider,
  UpgradeTargetScope,
} from '../../types/upgradeInsights';
import { isValidGuid } from './az-cli-core';
import { ARM_ENDPOINT, azRequest, AzureRequestError } from './az-http';
import { getSubscriptions } from './az-subscriptions';

const FLEET_API_VERSION = '2025-03-01';
const UPGRADE_PROFILE_API_VERSION = '2024-10-01';
const CACHE_TTL_MS = 60_000;

export interface UpgradeInsightSubscription {
  id: string;
  name: string;
  tenantId: string;
}

export type ArmTransport = (
  path: string,
  method: 'GET' | 'POST',
  body?: GenerateRequest,
  signal?: AbortSignal
) => Promise<unknown>;

const subscriptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tenant: z.string().uuid(),
  status: z.string(),
});
const clusterSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string(),
  properties: z.object({
    kubernetesVersion: z.string().optional(),
    currentKubernetesVersion: z.string().optional(),
    agentPoolProfiles: z
      .array(
        z.object({
          name: z.string(),
          orchestratorVersion: z.string().optional(),
          currentOrchestratorVersion: z.string().optional(),
          nodeImageVersion: z.string().optional(),
        })
      )
      .nullish(),
  }),
});
const fleetSchema = z.object({ id: z.string(), name: z.string() });
const fleetMemberSchema = z.object({
  properties: z.object({ clusterResourceId: z.string() }),
});
const targetProfileSchema = z.object({
  upgrades: z.array(z.object({ kubernetesVersion: z.string() })).nullish(),
});
const upgradeProfileSchema = z.object({
  properties: z.object({ controlPlaneProfile: targetProfileSchema }),
});
const agentPoolUpgradeProfileSchema = z.object({ properties: targetProfileSchema });

export async function getUpgradeInsightSubscriptions(): Promise<UpgradeInsightSubscription[]> {
  const subscriptions = z.array(subscriptionSchema).parse(await getSubscriptions());
  return subscriptions
    .filter(subscription => subscription.status.toLowerCase() === 'enabled')
    .map(subscription => ({
      id: subscription.id,
      name: subscription.name,
      tenantId: subscription.tenant,
    }));
}

export function createUpgradeInsightsProvider(
  subscriptions: UpgradeInsightSubscription[]
): ArmProvider {
  const tenants = new Map(
    subscriptions.map(subscription => [subscription.id.toLowerCase(), subscription.tenantId])
  );
  if (subscriptions.some(subscription => !isValidGuid(subscription.tenantId))) {
    throw new Error('Each subscription requires a valid Azure tenant ID.');
  }
  const transport: ArmTransport = async (path, method, body, signal) => {
    const url = new URL(path, ARM_ENDPOINT);
    const subscriptionId = /^\/subscriptions\/([^/]+)\//i.exec(url.pathname)?.[1];
    const tenantId = subscriptionId && tenants.get(subscriptionId.toLowerCase());
    if (url.origin !== ARM_ENDPOINT || !tenantId) {
      throw new Error(
        'Upgrade Insights requests must use a selected subscription in Azure public cloud.'
      );
    }
    if (method === 'POST' && !/\/generateUpgradeInsights$/i.test(url.pathname)) {
      throw new Error('Only readiness generation is permitted; upgrades are not supported.');
    }
    return azRequest<unknown>({ url: url.href, method, body, tenantId, signal });
  };
  return new ArmProvider(
    transport,
    subscriptions.map(subscription => subscription.id)
  );
}

export function clusterBase(cluster: Cluster): string {
  if (
    !/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^/\\?#]+\/providers\/Microsoft\.ContainerService\/managedClusters\/[^/\\?#]+$/i.test(
      cluster.id
    )
  ) {
    throw new Error('Invalid AKS resource ID.');
  }
  return cluster.id
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)])
  );
}

export class ArmProvider implements InsightsProvider {
  readonly mode = 'live';
  private insightCache = new Map<string, { expiresAt: number; insights: Insight[] }>();
  private targetCache = new Map<string, { expiresAt: number; targets: string[] }>();

  constructor(private transport: ArmTransport, private subscriptions: string[]) {
    if (!subscriptions.length || subscriptions.some(subscription => !isValidGuid(subscription))) {
      throw new Error('Select at least one valid Azure subscription.');
    }
  }

  invalidateInsights(): void {
    this.insightCache.clear();
  }

  private async pages<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T[]> {
    const result: T[] = [];
    const seen = new Set<string>();
    let next: string | undefined = path;
    while (next) {
      throwIfAborted(signal);
      if (seen.has(next) || seen.size >= 100) {
        throw new Error('ARM pagination loop or page limit reached.');
      }
      seen.add(next);
      const response = await this.transport(next, 'GET', undefined, signal);
      const page = z
        .object({ value: z.array(schema), nextLink: z.string().nullish() })
        .parse(response);
      result.push(...page.value);
      if (page.nextLink) {
        const url = new URL(page.nextLink, ARM_ENDPOINT);
        const subscription = /^\/subscriptions\/([^/]+)\//i.exec(url.pathname)?.[1];
        if (
          url.origin !== ARM_ENDPOINT ||
          !subscription ||
          !this.subscriptions.some(id => id.toLowerCase() === subscription.toLowerCase())
        ) {
          throw new Error('Untrusted ARM pagination URL.');
        }
        next = `${url.pathname}${url.search}`;
      } else {
        next = undefined;
      }
    }
    throwIfAborted(signal);
    return result;
  }

  async listClusters(signal?: AbortSignal): Promise<ClusterInventory> {
    const load = async (subscription: string) => {
      const values = await this.pages(
        `/subscriptions/${subscription}/providers/Microsoft.ContainerService/managedClusters?api-version=${API_VERSION}`,
        clusterSchema,
        signal
      );
      const memberships = new Map<string, { id: string; name: string }[]>();
      const fleetWarnings: string[] = [];
      try {
        const fleets = await this.pages(
          `/subscriptions/${subscription}/providers/Microsoft.ContainerService/fleets?api-version=${FLEET_API_VERSION}`,
          fleetSchema,
          signal
        );
        for (const fleet of fleets) {
          try {
            const members = await this.pages(
              `${fleet.id}/members?api-version=${FLEET_API_VERSION}`,
              fleetMemberSchema,
              signal
            );
            for (const member of members) {
              const key = member.properties.clusterResourceId.toLowerCase();
              memberships.set(key, [
                ...(memberships.get(key) ?? []),
                { id: fleet.id, name: fleet.name },
              ]);
            }
          } catch (error) {
            throwIfAborted(signal);
            fleetWarnings.push(`Fleet ${fleet.name}: ${String(error)}`);
          }
        }
      } catch (error) {
        throwIfAborted(signal);
        fleetWarnings.push(`Subscription ${subscription}: ${String(error)}`);
      }
      return {
        clusters: values.map(cluster => ({
          id: cluster.id,
          name: cluster.name,
          subscription,
          resourceGroup: cluster.id.split('/')[4],
          location: cluster.location,
          kubernetesVersion:
            cluster.properties.currentKubernetesVersion ?? cluster.properties.kubernetesVersion,
          poolInventoryKnown: Array.isArray(cluster.properties.agentPoolProfiles),
          pools: (cluster.properties.agentPoolProfiles ?? []).map(pool => ({
            name: pool.name,
            version: pool.currentOrchestratorVersion ?? pool.orchestratorVersion,
            nodeImageVersion: pool.nodeImageVersion,
          })),
        })),
        memberships,
        fleetWarnings,
      };
    };
    const groups: PromiseSettledResult<Awaited<ReturnType<typeof load>>>[] = [];
    for (let index = 0; index < this.subscriptions.length; index += 4) {
      throwIfAborted(signal);
      groups.push(
        ...(await Promise.allSettled(this.subscriptions.slice(index, index + 4).map(load)))
      );
    }
    throwIfAborted(signal);
    const clusters: Cluster[] = [];
    const warnings: string[] = [];
    const fleetWarnings: string[] = [];
    const memberships = new Map<string, { id: string; name: string }[]>();
    groups.forEach((group, index) => {
      if (group.status === 'fulfilled') {
        clusters.push(...group.value.clusters);
        fleetWarnings.push(...group.value.fleetWarnings);
        group.value.memberships.forEach((fleets, id) =>
          memberships.set(id, [...(memberships.get(id) ?? []), ...fleets])
        );
      } else {
        warnings.push(`Subscription ${this.subscriptions[index]}: ${String(group.reason)}`);
        fleetWarnings.push(
          `Fleet membership coverage is incomplete for ${this.subscriptions[index]}.`
        );
      }
    });
    if (groups.every(group => group.status === 'rejected')) throw new Error(warnings.join('\n'));
    clusters.forEach(cluster => {
      cluster.fleets = memberships.get(cluster.id.toLowerCase()) ?? [];
      cluster.fleetMembershipKnown = fleetWarnings.length === 0;
    });
    return { clusters, warnings, fleetWarnings };
  }

  async listInsights(
    cluster: Cluster,
    signal?: AbortSignal,
    forceRefresh = false
  ): Promise<Insight[]> {
    throwIfAborted(signal);
    const key = cluster.id.toLowerCase();
    const cached = this.insightCache.get(key);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return structuredClone(cached.insights);
    }
    const insights = await this.pages(
      `${clusterBase(cluster)}/upgradeInsights?api-version=${API_VERSION}`,
      insightSchema,
      signal
    );
    this.insightCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, insights });
    return structuredClone(insights);
  }

  async getInsight(cluster: Cluster, resourceId: string, signal?: AbortSignal): Promise<Insight> {
    throwIfAborted(signal);
    const prefix = `${cluster.id}/upgradeInsights/`;
    const name = resourceId.slice(prefix.length);
    if (
      !resourceId.toLowerCase().startsWith(prefix.toLowerCase()) ||
      !name ||
      /[/?#\\%]/.test(name) ||
      name === '.' ||
      name === '..'
    ) {
      throw new Error('Insight resource ID must belong to the selected AKS cluster.');
    }
    try {
      const result = insightSchema.parse(
        await this.transport(
          `${clusterBase(cluster)}/upgradeInsights/${encodeURIComponent(
            name
          )}?api-version=${API_VERSION}`,
          'GET',
          undefined,
          signal
        )
      );
      throwIfAborted(signal);
      return result;
    } catch (error) {
      if (error instanceof AzureRequestError && error.status === 404) {
        this.insightCache.delete(cluster.id.toLowerCase());
      }
      throw error;
    }
  }

  async listUpgradeTargets(
    cluster: Cluster,
    scope: UpgradeTargetScope,
    signal?: AbortSignal
  ): Promise<string[]> {
    throwIfAborted(signal);
    const poolName = scope.upgradeType === 'AgentPool' ? scope.agentPoolName : '';
    const key = `${cluster.id.toLowerCase()}/${scope.upgradeType}/${poolName}`;
    const cached = this.targetCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.targets);
    let selected: z.infer<typeof targetProfileSchema>;
    if (scope.upgradeType === 'AgentPool') {
      if (!cluster.pools.some(pool => pool.name === scope.agentPoolName)) {
        throw new Error('The selected node pool is not present in the cluster inventory.');
      }
      selected = agentPoolUpgradeProfileSchema.parse(
        await this.transport(
          `${clusterBase(cluster)}/agentPools/${encodeURIComponent(
            scope.agentPoolName
          )}/upgradeProfiles/default?api-version=${UPGRADE_PROFILE_API_VERSION}`,
          'GET',
          undefined,
          signal
        )
      ).properties;
    } else {
      selected = upgradeProfileSchema.parse(
        await this.transport(
          `${clusterBase(
            cluster
          )}/upgradeProfiles/default?api-version=${UPGRADE_PROFILE_API_VERSION}`,
          'GET',
          undefined,
          signal
        )
      ).properties.controlPlaneProfile;
    }
    throwIfAborted(signal);
    const targets = [...new Set((selected.upgrades ?? []).map(target => target.kubernetesVersion))];
    targets.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    this.targetCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, targets });
    return structuredClone(targets);
  }

  async generate(
    cluster: Cluster,
    request: GenerateRequest,
    signal?: AbortSignal
  ): Promise<Insight> {
    throwIfAborted(signal);
    this.insightCache.delete(cluster.id.toLowerCase());
    const generated = insightSchema.parse(
      await this.transport(
        `${clusterBase(cluster)}/generateUpgradeInsights?api-version=${API_VERSION}`,
        'POST',
        request,
        signal
      )
    );
    if (!generated.id)
      throw new Error('Generate returned no insight resource ID for verification.');
    if (
      generated.properties.upgradeType !== request.upgradeType ||
      ('agentPoolName' in request &&
        generated.properties.agentPoolName !== request.agentPoolName) ||
      ('targetKubernetesVersion' in request &&
        generated.properties.targetKubernetesVersion !== request.targetKubernetesVersion) ||
      ('targetNodeImageVersion' in request &&
        request.targetNodeImageVersion &&
        generated.properties.targetNodeImageVersion !== request.targetNodeImageVersion)
    ) {
      throw new Error('Generate returned an evaluation for a different scope or target.');
    }
    const verified = await this.getInsight(cluster, generated.id, signal);
    if (
      verified.id?.toLowerCase() !== generated.id.toLowerCase() ||
      verified.name !== generated.name ||
      JSON.stringify(canonicalJson(verified.properties)) !==
        JSON.stringify(canonicalJson(generated.properties))
    ) {
      throw new Error(
        'The stored insight does not match the generated evaluation. Refresh and retry.'
      );
    }
    return verified;
  }
}
