// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Cluster, ClusterRecord, Insight, Issue, Scope } from '../../types/upgradeInsights';

/** Conservative snapshot classification; Ready is neither an upgrade nor a physical-capacity guarantee. */
export type Readiness =
  | 'Blocked'
  | 'Review warnings'
  | 'Ready'
  | 'Re-check required'
  | 'Not evaluated'
  | 'Unavailable';

/** Ascending risk-priority ordering used only to sort the currently loaded page. */
export const readinessOrder: Record<Readiness, number> = {
  Blocked: 0,
  Unavailable: 1,
  'Re-check required': 2,
  'Not evaluated': 3,
  'Review warnings': 4,
  Ready: 5,
};

/**
 * Project one stored insight into its own evaluated scopes without merging other resources.
 * @param insight Stored standalone or combined evaluation.
 * @returns Display-name/result pairs, preserving the original per-scope snapshot payloads.
 */
export function scopes(insight: Insight): { name: string; result: Scope }[] {
  const p = insight.properties;
  if (p.upgradeType === 'ControlPlaneAndAgentPools') {
    return [
      ...(p.controlPlane ? [{ name: 'Control plane', result: p.controlPlane }] : []),
      ...(p.agentPools ?? []).map(result => ({
        name: result.agentPoolName ?? 'Unnamed pool',
        result,
      })),
    ];
  }
  return [{ name: p.agentPoolName ?? 'Control plane', result: p }];
}

/**
 * Flatten a stored evaluation's issues while retaining their originating scopes.
 * @param insight Optional stored evaluation; absence contributes no reported issues.
 * @returns Items with a rendering key derived from resource/scope/index, scope display name, and original issue.
 */
export function issuesFor(insight?: Insight): { key: string; scope: string; issue: Issue }[] {
  if (!insight) return [];
  return scopes(insight).flatMap(({ name, result }) =>
    (result.evaluation?.detectedIssues ?? []).map((issue, index) => ({
      key: `${insight.name}/${name}/${index}`,
      scope: name,
      issue,
    }))
  );
}

/**
 * Select the combined evaluation used for inventory readiness without mixing standalone checks.
 * @param record Cluster and its independent stored evaluations.
 * @returns An undated combined result conservatively preferred over dated results, otherwise the
 * most recently evaluated combined result, or undefined when none exists.
 */
export function latestCombined(record: ClusterRecord): Insight | undefined {
  const combined = record.insights.filter(
    i => i.properties.upgradeType === 'ControlPlaneAndAgentPools'
  );
  // An undated result must not be hidden behind a potentially older successful snapshot.
  const undated = combined.find(
    i => !Number.isFinite(Date.parse(i.properties.lastEvaluatedAt ?? ''))
  );
  return (
    undated ??
    combined.sort(
      (a, b) =>
        (Date.parse(b.properties.lastEvaluatedAt ?? '') || 0) -
        (Date.parse(a.properties.lastEvaluatedAt ?? '') || 0)
    )[0]
  );
}

/**
 * Assess snapshot age, service expiry, scope timestamps, and source-version comparability.
 * @param insight Stored evaluation whose timestamps and source versions are inspected.
 * @param cluster Current inventory metadata against which the stored source is compared.
 * @param now Current epoch time in milliseconds; injectable for deterministic freshness checks.
 * @returns A translation-key warning for the first freshness problem, or undefined when checks pass.
 */
export function freshness(
  insight: Insight,
  cluster: Cluster,
  now = Date.now()
): string | undefined {
  const p = insight.properties;
  const evaluated = Date.parse(p.lastEvaluatedAt ?? '');
  const expires = Date.parse(p.expiresAt ?? '');
  if (!Number.isFinite(evaluated) || !Number.isFinite(expires)) {
    return 'Evaluation freshness is unknown.';
  }
  if (expires <= now) return 'Stored evaluation has expired.';
  if (evaluated > now + 60_000) return 'Evaluation timestamp is in the future.';
  if (now - evaluated > 24 * 60 * 60 * 1000) {
    return 'Snapshot is more than 24 hours old. Re-check before upgrading.';
  }
  if (
    scopes(insight).some(
      ({ result }) =>
        result.evaluation &&
        (!Number.isFinite(Date.parse(result.evaluation.evaluatedAt)) ||
          now - Date.parse(result.evaluation.evaluatedAt) > 24 * 60 * 60 * 1000 ||
          Date.parse(result.evaluation.evaluatedAt) > now + 60_000)
    )
  ) {
    return 'A scope snapshot is stale or has an invalid evaluation time.';
  }
  if (
    p.upgradeType !== 'NodeImage' &&
    scopes(insight).some(({ name, result }) => {
      const current =
        name === 'Control plane'
          ? cluster.kubernetesVersion
          : cluster.pools.find(pool => pool.name === name)?.version;
      return !current || !result.currentKubernetesVersion;
    })
  ) {
    return 'Current and evaluated source versions cannot be compared.';
  }
  if (
    scopes(insight).some(({ name, result }) => {
      const current =
        name === 'Control plane'
          ? cluster.kubernetesVersion
          : cluster.pools.find(pool => pool.name === name)?.version;
      return (
        current && result.currentKubernetesVersion && current !== result.currentKubernetesVersion
      );
    })
  ) {
    return 'Cluster version changed since this evaluation.';
  }
  if (p.upgradeType === 'NodeImage') {
    const pool = cluster.pools.find(pool => pool.name === p.agentPoolName);
    if (!pool?.nodeImageVersion || !p.currentNodeImageVersion) {
      return 'Current and evaluated node image versions cannot be compared.';
    }
    if (pool.nodeImageVersion !== p.currentNodeImageVersion) {
      return 'Node image changed since this evaluation.';
    }
  }
}

/**
 * Classify one stored evaluation without interpreting missing or unfamiliar data as Ready.
 * @param insight Optional stored evaluation, independent of other overlapping resources.
 * @param cluster Current source versions and pool coverage needed to assess completeness.
 * @param now Epoch time in milliseconds used for freshness checks.
 * @returns A conservative snapshot state, not permission to upgrade or a reservation of capacity.
 */
export function readiness(
  insight: Insight | undefined,
  cluster: Cluster,
  now = Date.now()
): Readiness {
  if (!insight) return 'Not evaluated';
  const p = insight.properties;
  if (
    !['ControlPlane', 'ControlPlaneAndAgentPools', 'AgentPool', 'NodeImage'].includes(p.upgradeType)
  ) {
    return 'Unavailable';
  }
  if (p.upgradeType === 'NodeImage' ? !p.targetNodeImageVersion : !p.targetKubernetesVersion) {
    return 'Not evaluated';
  }
  if (
    ['AgentPool', 'NodeImage'].includes(p.upgradeType) &&
    (!p.agentPoolName || !cluster.pools.some(pool => pool.name === p.agentPoolName))
  ) {
    return 'Not evaluated';
  }
  if (p.provisioningState === 'Failed' || p.provisioningState === 'Canceled') return 'Unavailable';
  if (p.provisioningState !== 'Succeeded') return 'Not evaluated';
  if (freshness(insight, cluster, now)) return 'Re-check required';
  const results = scopes(insight);
  if (!results.length || results.some(s => !s.result.evaluation)) return 'Not evaluated';
  if (
    p.upgradeType === 'ControlPlaneAndAgentPools' &&
    (!p.controlPlane ||
      !p.agentPools ||
      cluster.poolInventoryKnown === false ||
      cluster.pools.some(pool => !p.agentPools?.some(s => s.agentPoolName === pool.name)))
  ) {
    return 'Not evaluated';
  }
  const evaluations = results.flatMap(s => (s.result.evaluation ? [s.result.evaluation] : []));
  if (
    evaluations.some(
      e =>
        !['Passed', 'Warning', 'Failed'].includes(e.status) ||
        !Number.isFinite(Date.parse(e.evaluatedAt))
    )
  ) {
    return 'Unavailable';
  }
  const issues = issuesFor(insight);
  if (issues.some(i => !['Blocking', 'Warning'].includes(i.issue.severity ?? ''))) {
    return 'Unavailable';
  }
  if (
    issues.some(i => i.issue.severity === 'Blocking') ||
    evaluations.some(e => e.status === 'Failed')
  ) {
    return 'Blocked';
  }
  if (issues.length || evaluations.some(e => e.status === 'Warning')) return 'Review warnings';
  return 'Ready';
}

/**
 * Derive inventory readiness from the latest combined snapshot, preserving read failures.
 * @param record Cluster inventory, stored evaluations, and any insight-read error.
 * @returns Unavailable on a read error, otherwise the selected combined snapshot's readiness.
 */
export function recordReadiness(record: ClusterRecord): Readiness {
  return record.error ? 'Unavailable' : readiness(latestCombined(record), record.cluster);
}

/**
 * Restrict server-provided remediation links to approved HTTPS documentation hosts.
 * @param value Untrusted optional URL from an insight's recommended actions.
 * @returns A normalized allowlisted URL without credentials or unusual ports, otherwise undefined.
 */
export function safeDocumentationUrl(value?: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      ['learn.microsoft.com', 'aka.ms', 'kubernetes.io'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443')
    ) {
      return url.href;
    }
  } catch {
    // Untrusted links are shown only as text.
  }
}

/**
 * Format a parseable timestamp using the viewer's locale and local time zone.
 * @param value Optional server-provided timestamp.
 * @returns Localized date/time text, or undefined so the caller can translate its unavailable label.
 */
export function formatTime(value?: string): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}

/**
 * Quote a CSV cell and neutralize spreadsheet formula prefixes, including leading whitespace.
 * @param value Raw display or API text to include in a local export.
 * @returns A double-quoted CSV field with embedded quotes escaped and risky prefixes apostrophe-prefixed.
 */
export function csvCell(value: string): string {
  const safe = /^\s*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Convert a rejected value to displayable error data without replacing failure with success.
 * @param error Error instance or arbitrary rejected value.
 * @returns The Error message when available, otherwise the value's string representation.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
