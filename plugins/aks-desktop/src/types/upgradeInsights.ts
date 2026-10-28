// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { z } from 'zod';

/** ARM preview API version for managed-cluster inventory and Upgrade Insights resources. */
export const API_VERSION = '2026-08-02-preview';
/** Evaluation scopes supported by the generation form; none initiates an upgrade. */
export const upgradeTypes = [
  'ControlPlaneAndAgentPools',
  'ControlPlane',
  'AgentPool',
  'NodeImage',
] as const;
/** Supported generation discriminator, independent of the target Kubernetes or image version. */
export type UpgradeType = (typeof upgradeTypes)[number];

/** Resource references reported by Azure; ARM and Kubernetes identifiers may be absent. */
const impactedResourceSchema = z
  .object({
    /** Reported resource kind, such as a PodDisruptionBudget. */
    kind: z.string(),
    /** Optional Azure or Kubernetes resource type supplied by the evaluation. */
    resourceType: z.string().optional(),
    /** Optional resource identifier; displayed as data, not used as a request endpoint. */
    resourceId: z.string().optional(),
    /** Kubernetes namespace when the affected resource is namespaced. */
    namespace: z.string().optional(),
    /** Resource name when Azure supplies one. */
    name: z.string().optional(),
  })
  .passthrough();

/** Preserves server issue fields, including unknown categories or severities for conservative display. */
export const issueSchema = z
  .object({
    /** Server category used to group issues; unknown categories retain their original value. */
    issueType: z.string().optional(),
    /** Server severity; missing or unfamiliar values must not imply readiness. */
    severity: z.string().optional(),
    /** Server-provided explanation of the detected risk. */
    message: z.string().optional(),
    /** Resource references associated with this issue in the stored snapshot. */
    impactedResources: z.array(impactedResourceSchema).optional(),
    /** Informational remediation guidance; rendering it never applies changes. */
    recommendedActions: z
      .array(
        z
          .object({
            /** Short description of the suggested action. */
            title: z.string().optional(),
            /** Additional instructions supplied by Azure. */
            details: z.string().optional(),
            /** Untrusted documentation URL that must pass presentation allowlisting. */
            documentationLink: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

/** Upgrade and maintenance context captured with an evaluation, not a live scheduling guarantee. */
const contextSchema = z
  .object({
    /** Upgrade strategy reported when the scope was evaluated. */
    currentUpgradeStrategy: z.string().optional(),
    /** Timestamp of the last successful upgrade known to the service. */
    lastSuccessfulUpgradeTime: z.string().optional(),
    /** Next reported maintenance window; its presence does not schedule an upgrade. */
    nextMaintenanceWindow: z
      .object({
        /** Name of the maintenance configuration that supplied the window. */
        maintenanceConfigurationName: z.string().optional(),
        /** Service-reported origin of the window when available. */
        source: z.string().optional(),
        /** Reported window start timestamp. */
        startTime: z.string().optional(),
        /** Reported window end timestamp. */
        endTime: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Stored control-plane or node-pool evaluation, retaining unknown preview API fields. */
export const scopeSchema = z
  .object({
    /** Pool identity for pool-scoped results; omitted for the control plane. */
    agentPoolName: z.string().optional(),
    /** Source Kubernetes version used by this evaluation, not necessarily the live version. */
    currentKubernetesVersion: z.string().optional(),
    /** Service-reported support classification of the evaluated source version. */
    kubernetesVersionSupportStatus: z.string().optional(),
    /** Service-reported end-of-support timestamp for the source version. */
    kubernetesVersionEndOfSupportDate: z.string().optional(),
    /** Upgrade strategy and maintenance context captured with the scope. */
    context: contextSchema.optional(),
    /** Optional evaluation payload; absence is not a successful evaluation. */
    evaluation: z
      .object({
        /** Server rollup, normally Passed, Warning, or Failed; unknown values remain visible. */
        status: z.string(),
        /** Scope evaluation timestamp, validated for freshness by the domain helpers. */
        evaluatedAt: z.string(),
        /** Issues reported for this scope only, without merging overlapping stored evaluations. */
        detectedIssues: z.array(issueSchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** ARM insight resource; unknown fields survive parsing for raw-response inspection. */
export const insightSchema = z
  .object({
    /** Full stored-resource ARM ID, required by the provider when verifying generation. */
    id: z.string().optional(),
    /** Resource name used as a selection fallback when an ID is absent. */
    name: z.string(),
    /** ARM resource type supplied by the service. */
    type: z.string().optional(),
    /** Snapshot scope, targets, lifecycle, and nested evaluation results. */
    properties: scopeSchema.extend({
      /** Server discriminator; kept as a string so unsupported future scopes fail conservatively. */
      upgradeType: z.string(),
      /** Insight computation lifecycle, distinct from the evaluation's risk status. */
      provisioningState: z.string().optional(),
      /** Resource-level evaluation timestamp used to order and assess stored snapshots. */
      lastEvaluatedAt: z.string().optional(),
      /** Service expiration timestamp; the UI also applies its own 24-hour freshness policy. */
      expiresAt: z.string().optional(),
      /** Kubernetes target evaluated for non-NodeImage scopes. */
      targetKubernetesVersion: z.string().optional(),
      /** Node image used as the source of a NodeImage evaluation. */
      currentNodeImageVersion: z.string().optional(),
      /** Node image evaluated as the target, including an Azure-selected latest image. */
      targetNodeImageVersion: z.string().optional(),
      /** Control-plane result nested in a combined evaluation. */
      controlPlane: scopeSchema.optional(),
      /** Pool results nested in a combined evaluation; missing pools prevent confirmed readiness. */
      agentPools: z.array(scopeSchema).optional(),
    }),
  })
  .passthrough();

/** Parsed stored insight; a favorable snapshot does not guarantee upgrade success or capacity. */
export type Insight = z.infer<typeof insightSchema>;
/** Parsed scope snapshot with the fields documented by {@link scopeSchema}. */
export type Scope = z.infer<typeof scopeSchema>;
/** Parsed risk and informational remediation fields documented by {@link issueSchema}. */
export type Issue = z.infer<typeof issueSchema>;

/** Exact body confirmed before storing an evaluation; never an upgrade or remediation request. */
export type GenerateRequest =
  | {
      /** Evaluate only the control plane. */
      upgradeType: 'ControlPlane';
      /** API-discovered Kubernetes target explicitly selected by the user. */
      targetKubernetesVersion: string;
    }
  | {
      /** Evaluate the control plane and all node pools together. */
      upgradeType: 'ControlPlaneAndAgentPools';
      /** API-discovered Kubernetes target explicitly selected by the user. */
      targetKubernetesVersion: string;
    }
  | {
      /** Evaluate one node pool's Kubernetes upgrade. */
      upgradeType: 'AgentPool';
      /** Exact pool name from the selected cluster's inventory. */
      agentPoolName: string;
      /** Kubernetes target discovered for this specific pool. */
      targetKubernetesVersion: string;
    }
  | {
      /** Evaluate a node image independently of Kubernetes target discovery. */
      upgradeType: 'NodeImage';
      /** Exact pool name from the selected cluster's inventory. */
      agentPoolName: string;
      /** Explicit image target, or omitted to let Azure select the latest available image. */
      targetNodeImageVersion?: string;
    };

/** Scope for Kubernetes target discovery; NodeImage deliberately has no such dependency. */
export type UpgradeTargetScope =
  | {
      /** Control-plane profile used for standalone or combined evaluation targets. */
      upgradeType: 'ControlPlane' | 'ControlPlaneAndAgentPools';
    }
  | {
      /** Select the pool-specific upgrade profile instead of the control-plane profile. */
      upgradeType: 'AgentPool';
      /** Exact inventory pool whose available Kubernetes targets are requested. */
      agentPoolName: string;
    };

/** Azure inventory identity and current source versions used to interpret stored evaluations. */
export interface Cluster {
  /** Full managed-cluster ARM ID; authoritative for requests and explicit selection. */
  id: string;
  /** Display name, never sufficient to bind a Kubernetes context to an ARM resource. */
  name: string;
  /** Optional context display metadata, not an authoritative Azure identity. */
  contextName?: string;
  /** Owning Azure subscription ID, not its display name. */
  subscription: string;
  /** Resource group containing the managed cluster. */
  resourceGroup: string;
  /** Azure region reported by managed-cluster inventory. */
  location: string;
  /** Optional environment metadata included in inventory search. */
  environment?: string;
  /** Current control-plane version reported by inventory, for snapshot comparison. */
  kubernetesVersion?: string;
  /** Whether inventory supplied a pool list; false prevents confirmed combined readiness. */
  poolInventoryKnown?: boolean;
  /** Whether fleet discovery completed without coverage errors. */
  fleetMembershipKnown?: boolean;
  /** Discovered memberships; an empty list is authoritative only when coverage is known. */
  fleets?: {
    /** Full ARM ID of the associated fleet. */
    id: string;
    /** Fleet display name used for inventory presentation and search. */
    name: string;
  }[];
  /** Pools reported by inventory; absence of version fields is not a readiness success. */
  pools: {
    /** Exact pool identity used by pool-scoped requests. */
    name: string;
    /** Current pool Kubernetes version, falling back to the configured version when necessary. */
    version?: string;
    /** Current node image version used to assess NodeImage snapshot freshness. */
    nodeImageVersion?: string;
  }[];
}

/** Per-cluster stored insight read, including a failed read without synthetic replacement data. */
export interface ClusterRecord {
  /** Inventory identity and live-reported source versions for this read. */
  cluster: Cluster;
  /** Independent stored evaluations; callers must not merge overlapping scopes. */
  insights: Insight[];
  /** Read failure surfaced as Unavailable rather than a successful empty evaluation. */
  error?: string;
}

/** Reachable inventory with explicit subscription and optional fleet-coverage gaps. */
export interface ClusterInventory {
  /** Clusters read successfully from the explicitly selected subscriptions. */
  clusters: Cluster[];
  /** Subscription inventory failures; totals cover only the reachable portion. */
  warnings: string[];
  /** Fleet discovery failures, which do not discard otherwise readable clusters. */
  fleetWarnings: string[];
}

/** Stored-readiness data source; generation writes an insight, never performs an upgrade. */
export interface InsightsProvider {
  /** Source provenance; the native Azure factory always supplies live mode. */
  readonly mode: 'demo' | 'live';
  /**
   * Discard cached insight snapshots before a user-requested refresh.
   * @returns No value; subsequent reads may populate the cache again.
   */
  invalidateInsights(): void;
  /**
   * Read managed-cluster inventory with explicit coverage warnings.
   * @param signal Optional cancellation for the inventory request and its follow-up reads.
   * @returns Reachable clusters and coverage warnings; rejects if no subscription can be read.
   */
  listClusters(signal?: AbortSignal): Promise<ClusterInventory>;
  /**
   * Read independent stored evaluations without computing new ones.
   * @param cluster Authoritative managed-cluster identity to query.
   * @param signal Optional cancellation for the read.
   * @param forceRefresh Whether to bypass a valid provider insight cache entry.
   * @returns Stored evaluation resources, possibly empty; read errors reject.
   */
  listInsights(cluster: Cluster, signal?: AbortSignal, forceRefresh?: boolean): Promise<Insight[]>;
  /**
   * Read a specific stored insight belonging to the selected cluster.
   * @param cluster Managed cluster that must own the insight.
   * @param resourceId Full insight ARM ID, not a display name or arbitrary URL.
   * @param signal Optional cancellation for the read.
   * @returns The parsed stored resource; identity or read errors reject.
   */
  getInsight(cluster: Cluster, resourceId: string, signal?: AbortSignal): Promise<Insight>;
  /**
   * Discover Kubernetes targets for the exact evaluation scope.
   * @param cluster Managed cluster whose upgrade profile is queried.
   * @param scope Control-plane or named-pool profile; never NodeImage.
   * @param signal Optional cancellation for target discovery.
   * @returns Available version strings, not a promise of physical capacity or upgrade success.
   */
  listUpgradeTargets(
    cluster: Cluster,
    scope: UpgradeTargetScope,
    signal?: AbortSignal
  ): Promise<string[]>;
  /**
   * Store an evaluation after the caller confirms the exact scope and target.
   * @param cluster Managed cluster on which to store the insight.
   * @param request Confirmed evaluation body; no upgrade or remediation operations are permitted.
   * @param signal Optional cancellation; it cannot undo a POST already accepted by Azure.
   * @returns The generated resource verified by an exact stored-resource GET.
   */
  generate(cluster: Cluster, request: GenerateRequest, signal?: AbortSignal): Promise<Insight>;
}

/** Translation keys for the supported generation scopes. */
export const scopeLabels: Record<UpgradeType, string> = {
  ControlPlaneAndAgentPools: 'Control plane + all node pools',
  ControlPlane: 'Control plane',
  AgentPool: 'Node pool',
  NodeImage: 'Node OS image',
};

/**
 * Translates known issue categories with literal keys discoverable by locale extraction.
 * @param t The current locale's translation function.
 * @returns Localized labels keyed by API category; unknown categories are intentionally absent.
 */
export function issueLabels(t: (key: string) => string): Record<string, string> {
  return {
    PDBConstraint: t('Disruption budgets'),
    SubnetIPExhausted: t('Subnet IP capacity'),
    QuotaExceeded: t('Compute quota'),
    APIBreakingChange: t('Removed APIs'),
    ComponentVersionMismatch: t('Component compatibility'),
    UnsupportedKubernetesVersion: t('Version support'),
    NodeImageOutOfSLA: t('Node image freshness'),
  };
}
