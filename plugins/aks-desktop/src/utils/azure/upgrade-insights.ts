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

/** Stable API version for optional fleet and member discovery, independent of insight preview APIs. */
const FLEET_API_VERSION = '2025-03-01';
/** Stable API version used to discover control-plane and pool Kubernetes targets. */
const UPGRADE_PROFILE_API_VERSION = '2024-10-01';
/** Client cache lifetime in milliseconds, unrelated to a stored evaluation's service expiry. */
const CACHE_TTL_MS = 60_000;

/** Enabled subscription and tenant binding used by the native authenticated transport. */
export interface UpgradeInsightSubscription {
  /** Azure subscription GUID explicitly selected for inventory and insight requests. */
  id: string;
  /** Account-provided display name shown alongside the subscription ID. */
  name: string;
  /** Tenant GUID used to obtain authorization for this subscription. */
  tenantId: string;
}

/**
 * Injectable ARM request boundary; parsing and stored-resource verification belong to the provider.
 * @param path ARM path or URL accepted by the transport's origin and subscription checks.
 * @param method Read-only GET, or POST exclusively for generating a stored evaluation.
 * @param body Confirmed generation body for POST; omitted for reads.
 * @param signal Optional cancellation propagated to the native HTTP request.
 * @returns Unvalidated ARM JSON; authentication, transport, and service errors reject.
 */
export type ArmTransport = (
  path: string,
  method: 'GET' | 'POST',
  body?: GenerateRequest,
  signal?: AbortSignal
) => Promise<unknown>;

/** Account inventory fields required before offering a subscription in the native UI. */
const subscriptionSchema = z.object({
  /** Subscription GUID returned by the existing Azure account integration. */
  id: z.string().uuid(),
  /** Subscription display name. */
  name: z.string(),
  /** Owning tenant GUID, renamed to tenantId in the public subscription contract. */
  tenant: z.string().uuid(),
  /** Account state used to exclude subscriptions that are not enabled. */
  status: z.string(),
});
/** Managed-cluster response subset needed for identity and source-version comparisons. */
const clusterSchema = z.object({
  /** Authoritative managed-cluster ARM identity. */
  id: z.string(),
  /** Display name, never used to bind a Kubernetes context automatically. */
  name: z.string(),
  /** Azure region used for inventory filtering. */
  location: z.string(),
  /** Inventory source versions and optional pool coverage. */
  properties: z.object({
    /** Configured control-plane version used only when the current version is absent. */
    kubernetesVersion: z.string().optional(),
    /** Preferred current control-plane version. */
    currentKubernetesVersion: z.string().optional(),
    /** Pool inventory; null or omitted means coverage is unknown, not an empty cluster. */
    agentPoolProfiles: z
      .array(
        z.object({
          /** Exact pool identity used by pool-specific profile and insight requests. */
          name: z.string(),
          /** Configured pool version used when the current version is absent. */
          orchestratorVersion: z.string().optional(),
          /** Preferred current pool Kubernetes version. */
          currentOrchestratorVersion: z.string().optional(),
          /** Current node image needed to compare NodeImage evaluations. */
          nodeImageVersion: z.string().optional(),
        })
      )
      .nullish(),
  }),
});
/** Fleet identity projected into the public cluster membership metadata. */
const fleetSchema = z.object({
  /** Full fleet ARM resource ID. */
  id: z.string(),
  /** Fleet display name used for presentation and search. */
  name: z.string(),
});
/** Member-to-cluster identity mapping; cluster names alone cannot establish membership. */
const fleetMemberSchema = z.object({
  /** Server-supplied membership association. */
  properties: z.object({
    /** Full managed-cluster ARM ID associated with this member. */
    clusterResourceId: z.string(),
  }),
});
/** Kubernetes version discovery, not a reservation or guarantee of physical capacity. */
const targetProfileSchema = z.object({
  /** Optional available upgrade targets; an omitted list produces no selectable versions. */
  upgrades: z
    .array(
      z.object({
        /** API-reported Kubernetes version available for this profile. */
        kubernetesVersion: z.string(),
      })
    )
    .nullish(),
});
/** Control-plane profile wrapper returned by the managed-cluster upgradeProfiles endpoint. */
const upgradeProfileSchema = z.object({
  /** Cluster upgrade-profile payload. */
  properties: z.object({
    /** Control-plane targets used for standalone and combined evaluations. */
    controlPlaneProfile: targetProfileSchema,
  }),
});
/** Pool endpoint response, whose properties directly contain the target profile. */
const agentPoolUpgradeProfileSchema = z.object({
  /** Targets belonging to the explicitly requested node pool. */
  properties: targetProfileSchema,
});

/**
 * Discover enabled subscriptions through AKS Desktop's existing Azure account integration.
 * @returns Validated subscription identities with tenant bindings; account or schema errors reject.
 */
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

/**
 * Create a native provider whose transport authenticates against each selected subscription's tenant.
 * @param subscriptions Explicitly selected enabled subscription/tenant bindings.
 * @returns A fresh provider restricted to Azure public cloud and the selected subscriptions.
 * @throws If selection identities are invalid; later requests reject disallowed origins or POST paths.
 */
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

/**
 * Validate and encode a managed-cluster ARM identity without inferring one from a display name.
 * @param cluster Cluster containing the full, unencoded managed-cluster resource ID.
 * @returns ARM resource path with each segment URL-encoded and separators preserved.
 * @throws If the ID is not a supported managed-cluster resource path.
 */
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

/**
 * Stop follow-up work when a request's owning session has been cancelled.
 * @param signal Optional cancellation signal to inspect.
 * @returns No value when the request is still active.
 * @throws An AbortError when the signal is already aborted.
 */
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

/**
 * Normalize object-key order before comparing generated and persisted response properties.
 * @param value JSON-compatible value to normalize recursively, preserving array order.
 * @returns A normalized copy of objects and arrays, or the unchanged scalar value.
 */
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)])
  );
}

/** ARM-backed stored-readiness provider; evaluations do not reserve capacity or perform upgrades. */
export class ArmProvider implements InsightsProvider {
  /** Native response provenance, with no synthetic fallback on request errors. */
  readonly mode = 'live';
  /** Per-cluster snapshots with client TTL deadlines; callers receive detached copies. */
  private insightCache = new Map<string, { expiresAt: number; insights: Insight[] }>();
  /** Per-cluster/scope/pool target lists with client TTL deadlines, independent of insight caching. */
  private targetCache = new Map<string, { expiresAt: number; targets: string[] }>();

  /**
   * Bind an injectable request transport to a non-empty inventory subscription selection.
   * @param transport ARM request boundary; the native factory adds tenant and endpoint enforcement.
   * @param subscriptions Subscription GUIDs to enumerate for inventory.
   * @throws If the subscription selection is empty or contains an invalid GUID.
   */
  constructor(private transport: ArmTransport, private subscriptions: string[]) {
    if (!subscriptions.length || subscriptions.some(subscription => !isValidGuid(subscription))) {
      throw new Error('Select at least one valid Azure subscription.');
    }
  }

  /**
   * Clear all cluster insight entries without changing target discovery's separate cache policy.
   * @returns No value; subsequent reads repopulate snapshots using the normal TTL.
   */
  invalidateInsights(): void {
    this.insightCache.clear();
  }

  /**
   * Read up to 100 ARM pages, rejecting loops and continuations outside the selected subscriptions.
   * @param path Initial ARM collection path.
   * @param schema Validator applied to every collection value.
   * @param signal Optional cancellation checked between requests and before returning results.
   * @returns Parsed collection entries across all trusted pages.
   */
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

  /**
   * Enumerate selected subscriptions in batches, retaining reachable inventory and coverage warnings.
   * @param signal Optional cancellation for cluster, fleet, and membership requests.
   * @returns Inventory with separate subscription and fleet warnings; rejects if all subscriptions fail.
   */
  async listClusters(signal?: AbortSignal): Promise<ClusterInventory> {
    /**
     * Read one subscription without treating fleet discovery failure as cluster inventory failure.
     * @param subscription Subscription GUID to enumerate.
     * @returns Current cluster metadata, discovered membership identities, and fleet coverage warnings.
     */
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

  /**
   * Read stored evaluations, using a detached copy of a valid 60-second cache entry when allowed.
   * @param cluster Managed cluster whose independent stored evaluations are requested.
   * @param signal Optional cancellation for the paginated read.
   * @param forceRefresh Bypass the current insight cache entry for this read only.
   * @returns Parsed stored insights; no new evaluation or upgrade is triggered.
   */
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

  /**
   * Retrieve the exact insight resource within the selected managed-cluster path.
   * @param cluster Required owner of the insight being read.
   * @param resourceId Full insight ARM ID, restricted to one child resource of this cluster.
   * @param signal Optional cancellation for the request and its response processing.
   * @returns Parsed stored insight; a 404 also invalidates this cluster's cached insight list.
   * @throws If identity validation, schema parsing, cancellation, or the ARM read fails.
   */
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

  /**
   * Discover targets from the exact control-plane or pool profile, with a separate 60-second cache.
   * @param cluster Managed cluster whose upgrade profile is queried.
   * @param scope Control-plane/combined profile or an exact inventory node-pool identity.
   * @param signal Optional cancellation for target discovery.
   * @returns Unique, numerically sorted Kubernetes versions; not a physical-capacity guarantee.
   * @throws If the pool is absent from inventory or profile validation or the ARM request fails.
   */
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

  /**
   * POST a confirmed evaluation request and verify its scope, target, and exact persisted resource.
   * @param cluster Managed cluster on which to store the insight, without starting an upgrade.
   * @param request Exact user-confirmed scope/target body; NodeImage may omit its service-selected target.
   * @param signal Optional cancellation; a previously accepted POST cannot be undone by aborting.
   * @returns The GET-verified stored insight, not an upgrade result or a capacity reservation.
   * @throws On request failure or response/verification mismatch; Azure may already have stored an insight.
   */
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
