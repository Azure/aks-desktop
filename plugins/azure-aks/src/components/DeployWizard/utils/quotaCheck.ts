// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { clusterRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import {
  formatCpu,
  formatMemory,
  parseCpuToMillicores,
  parseMemoryToBytes,
} from '../../../utils/shared/resourceUnits';

export interface QuotaWarning {
  /** The resource type that exceeds quota, e.g. "requests.memory" */
  resource: string;
  /** Human-readable amount requested by this deployment */
  requested: string;
  /** Human-readable remaining quota available */
  remaining: string;
  /** Human-readable hard limit */
  limit: string;
}

/** Kinds that have a pod template at spec.template.spec */
const POD_TEMPLATE_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'ReplicaSet']);

interface ResourceTotals {
  'requests.cpu': number;
  'requests.memory': number;
  'limits.cpu': number;
  'limits.memory': number;
}

const CPU_KEYS: ReadonlySet<string> = new Set<keyof ResourceTotals>(['requests.cpu', 'limits.cpu']);

function isCpuKey(key: string): boolean {
  return CPU_KEYS.has(key);
}

/**
 * Extracts total resource requirements from a set of Kubernetes documents.
 * Only considers kinds with pod templates (Deployment, StatefulSet, DaemonSet, Job, ReplicaSet).
 * Returns totals in millicores (CPU) and bytes (memory).
 */
function extractResourceTotals(docs: any[]): ResourceTotals {
  const totals: ResourceTotals = {
    'requests.cpu': 0,
    'requests.memory': 0,
    'limits.cpu': 0,
    'limits.memory': 0,
  };

  for (const doc of docs) {
    if (!doc?.kind || !POD_TEMPLATE_KINDS.has(doc.kind)) continue;

    // Note: only regular containers are summed; init containers are not
    // currently included (Kubernetes uses max(initContainers) vs sum(containers)).
    const containers = doc.spec?.template?.spec?.containers;
    if (!Array.isArray(containers)) continue;

    let replicas: number;
    if (doc.kind === 'Job') {
      const parallelism = doc.spec?.parallelism;
      if (typeof parallelism === 'number' && parallelism > 0) {
        replicas = parallelism;
      } else {
        replicas = 1;
      }
    } else {
      replicas = doc.spec?.replicas ?? 1;
    }

    for (const container of containers) {
      const resources = container?.resources;
      if (!resources) continue;

      if (resources.requests?.cpu) {
        totals['requests.cpu'] += parseCpuToMillicores(resources.requests.cpu) * replicas;
      }
      if (resources.requests?.memory) {
        totals['requests.memory'] += parseMemoryToBytes(resources.requests.memory) * replicas;
      }
      if (resources.limits?.cpu) {
        totals['limits.cpu'] += parseCpuToMillicores(resources.limits.cpu) * replicas;
      }
      if (resources.limits?.memory) {
        totals['limits.memory'] += parseMemoryToBytes(resources.limits.memory) * replicas;
      }
    }
  }

  return totals;
}

/** Returns the remaining quota for a given key, considering all quotas in the namespace. */
function getQuotaRemaining(quotas: any[], key: string): { remaining: number; hard: number } | null {
  let mostRestrictive: { remaining: number; hard: number } | null = null;

  for (const quota of quotas) {
    const hard = quota.status?.hard?.[key] ?? quota.spec?.hard?.[key];
    const used = quota.status?.used?.[key];
    if (hard === undefined) continue;

    const hardVal = isCpuKey(key) ? parseCpuToMillicores(hard) : parseMemoryToBytes(hard);
    const usedVal =
      used !== undefined
        ? isCpuKey(key)
          ? parseCpuToMillicores(used)
          : parseMemoryToBytes(used)
        : 0;
    const remaining = hardVal - usedVal;

    if (mostRestrictive === null || remaining < mostRestrictive.remaining) {
      mostRestrictive = { remaining, hard: hardVal };
    }
  }

  return mostRestrictive;
}

function formatResourceValue(key: string, value: number): string {
  return isCpuKey(key) ? formatCpu(value) : formatMemory(value);
}

/**
 * Fetches ResourceQuota objects for the given namespace and checks whether
 * the resource requests in the provided Kubernetes documents would exceed
 * the remaining quota.
 *
 * Returns an array of warnings (empty if no issues detected).
 * Fails open — returns empty array on fetch failure (e.g. RBAC).
 */
export async function checkResourceQuota(
  docs: any[],
  namespace: string,
  cluster?: string
): Promise<QuotaWarning[]> {
  let quotas: any[];
  try {
    const response: any = await clusterRequest(
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/resourcequotas`,
      { method: 'GET', cluster }
    );
    quotas = response?.items ?? [];
  } catch {
    // Fail open: RBAC or network errors should not block deployment
    return [];
  }

  if (quotas.length === 0) return [];

  const totals = extractResourceTotals(docs);
  const warnings: QuotaWarning[] = [];

  const keysToCheck: (keyof ResourceTotals)[] = [
    'requests.cpu',
    'requests.memory',
    'limits.cpu',
    'limits.memory',
  ];

  for (const key of keysToCheck) {
    const requested = totals[key];
    if (requested === 0) continue;

    const quota = getQuotaRemaining(quotas, key);
    if (!quota) continue;

    if (requested > quota.remaining) {
      warnings.push({
        resource: key,
        requested: formatResourceValue(key, requested),
        remaining: formatResourceValue(key, Math.max(0, quota.remaining)),
        limit: formatResourceValue(key, quota.hard),
      });
    }
  }

  return warnings;
}
