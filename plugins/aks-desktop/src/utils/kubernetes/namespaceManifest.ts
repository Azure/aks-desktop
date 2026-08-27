// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import YAML from 'yaml';

const DNS_LABEL_MAX_LENGTH = 63;

/**
 * Namespace network traffic policy, mirroring the AKS managed-namespace
 * `--ingress-policy` / `--egress-policy` options.
 *
 * - `AllowAll`           – allow all traffic in the given direction.
 * - `DenyAll`            – deny all traffic in the given direction.
 * - `AllowSameNamespace` – only allow traffic to/from pods in the same namespace.
 */
export type NamespaceTrafficPolicy = 'AllowSameNamespace' | 'AllowAll' | 'DenyAll';

/** A single RBAC assignment: an Azure AD object ID (or any K8s user name) and a UI role. */
export interface NamespaceUserAssignment {
  /** Azure AD object ID. Not a usable RoleBinding subject — see {@link upn}. */
  objectId: string;
  /**
   * The subject name used in the RoleBinding: the user's UPN.
   *
   * `kube-aad-proxy` authenticates the Entra token and impersonates the user to
   * the apiserver **by UPN** — the object ID arrives only as an `Extra: oid`
   * attribute, which RBAC subjects never match. A binding naming the object ID
   * therefore applies cleanly and grants nothing, silently. Assignments without a
   * UPN are skipped rather than bound to a name that cannot authorize.
   */
  upn?: string;
  /** UI role name: `Admin`, `Writer`, or `Reader`. */
  role: string;
}

/**
 * Options for {@link generateNamespaceManifestYaml}.
 *
 * These intentionally mirror the input surface of `createManagedNamespace`
 * (see `utils/azure/az-namespaces.ts`) so the same wizard form data can drive
 * either the Azure-backed managed namespace or a plain Kubernetes manifest.
 */
export interface GenerateNamespaceManifestOptions {
  /** Namespace name. Also used as the name prefix for the child resources. */
  namespaceName: string;
  /** CPU request quota in millicores (e.g. `2000` -> `2000m`). */
  cpuRequest?: number;
  /** CPU limit quota in millicores (e.g. `2000` -> `2000m`). */
  cpuLimit?: number;
  /** Memory request quota in mebibytes (e.g. `4096` -> `4096Mi`). */
  memoryRequest?: number;
  /** Memory limit quota in mebibytes (e.g. `4096` -> `4096Mi`). */
  memoryLimit?: number;
  /** Ingress traffic policy for the generated NetworkPolicy. */
  ingressPolicy?: NamespaceTrafficPolicy;
  /** Egress traffic policy for the generated NetworkPolicy. */
  egressPolicy?: NamespaceTrafficPolicy;
  /** Labels applied to the Namespace metadata. */
  labels?: Record<string, string>;
  /** Annotations applied to the Namespace metadata. */
  annotations?: Record<string, string>;
  /** RBAC assignments turned into per-user RoleBindings. */
  userAssignments?: NamespaceUserAssignment[];
  /**
   * Whether to emit RoleBindings for {@link userAssignments}. Defaults to `true`.
   *
   * Pass `false` for a cluster created with Azure RBAC (`enableAzureRbac: true`),
   * where the `guard` webhook authorizes from Azure role assignments instead —
   * bindings there would duplicate the grant and could outlive it.
   */
  includeRoleBindings?: boolean;
}

/**
 * Maps a UI role name to the built-in Kubernetes ClusterRole used for a
 * namespaced RoleBinding.
 *
 * - `Admin`  -> `admin` (full read/write within the namespace incl. RBAC)
 * - `Writer` -> `edit`  (read/write, no RBAC changes)
 * - `Reader` -> `view`  (read-only)
 *
 * Unknown roles fall back to `view` (least privilege).
 *
 * These built-in ClusterRoles are the intended equivalents of the Azure RBAC
 * `Reader`/`Writer`/`Admin` roles used by managed namespaces. This mapping is for
 * Arc clusters whose authorization is native Kubernetes RBAC
 * (`aadProfile.enableAzureRbac: false`), where access is granted with a
 * RoleBinding to these roles. Arc clusters using Azure RBAC authorize through the
 * `guard` webhook instead and get namespace-scoped Azure role assignments, with
 * no RoleBinding written — emitting both would grant the same access twice.
 */
export function mapUIRoleToClusterRole(uiRole: string): string {
  const roleMap: Record<string, string> = {
    Admin: 'admin',
    Writer: 'edit',
    Reader: 'view',
  };
  return roleMap[uiRole] ?? 'view';
}

/**
 * Builds the ingress/egress rule bodies for a NetworkPolicy from a traffic policy.
 *
 * Returns `undefined` when the direction should not be constrained at all
 * (so the corresponding policyType is omitted). Returns `[]` for a full deny,
 * `[{}]` for allow-all, and a same-namespace selector rule otherwise.
 *
 * For `AllowSameNamespace` the peer is expressed exactly as an AKS managed
 * namespace does — a `namespaceSelector` matching the namespace's own
 * `kubernetes.io/metadata.name` label (Kubernetes auto-stamps this label on
 * every namespace) — so the generated NetworkPolicy is byte-identical to the
 * one AKS projects for a managed namespace.
 */
function buildPolicyRule(
  policy: NamespaceTrafficPolicy | undefined,
  direction: 'ingress' | 'egress',
  namespaceName: string
): { rules: object[]; include: boolean } {
  if (!policy) {
    return { rules: [], include: false };
  }

  switch (policy) {
    case 'AllowAll':
      // A single empty rule allows all traffic in this direction.
      return { rules: [{}], include: true };
    case 'DenyAll':
      // policyType present with no rules denies all traffic in this direction.
      return { rules: [], include: true };
    case 'AllowSameNamespace': {
      // Restrict traffic to pods within the same namespace, selected by the
      // namespace's own name label (matching AKS managed-namespace output).
      const peer = {
        namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': namespaceName } },
      };
      return {
        rules: [direction === 'ingress' ? { from: [peer] } : { to: [peer] }],
        include: true,
      };
    }
    default:
      return { rules: [], include: false };
  }
}

/** A generated Kubernetes resource plus a short human-readable comment for the YAML view. */
export interface NamespaceManifestEntry {
  /** Comment shown above the resource in the YAML output (e.g. `RoleBinding (Admin)`). */
  comment: string;
  /** The Kubernetes object, ready to POST to the API. */
  resource: Record<string, unknown>;
}

/**
 * Builds the ordered set of Kubernetes objects that reproduce an AKS managed
 * namespace as native Kubernetes resources (no Azure API calls).
 *
 * The set contains, in apply order:
 * 1. `Namespace`      – with the provided labels/annotations.
 * 2. `ResourceQuota`  – namespace-wide CPU/memory request & limit caps.
 * 3. `NetworkPolicy`  – ingress/egress rules derived from the traffic policies.
 * 4. `RoleBinding`(s) – one per user assignment, bound to a built-in ClusterRole.
 *
 * To stay at parity with AKS managed namespaces (`az aks namespace add`), the
 * set intentionally contains *only* a `ResourceQuota` for the resource caps and
 * no `LimitRange`. This mirrors Azure exactly: once the quota constrains
 * requests/limits, pods that don't declare their own CPU/memory requests and
 * limits are rejected by the API server. See
 * https://learn.microsoft.com/azure/aks/concepts-managed-namespaces
 *
 * The `Namespace` is always first so callers can apply the entries in array
 * order — the namespaced children depend on it existing.
 *
 * @param options - See {@link GenerateNamespaceManifestOptions}.
 */
/**
 * Turns a UPN into the identifying part of a RoleBinding name.
 *
 * Uses the local part (before `@`), which is what a reader recognises — the
 * namespace already implies the tenant. Kubernetes names are RFC 1123
 * subdomains (lowercase alphanumeric, `-` and `.`), while Entra additionally
 * allows uppercase and `_ ! # ^ ~ '`; guest accounts like
 * `someone_gmail.com#EXT#@contoso.onmicrosoft.com` hit several of those at once,
 * so anything illegal is folded to `-`.
 *
 * The result is deliberately not unique — two tenants can share a local part.
 * Callers reserve room for and append a positional suffix, which makes
 * collisions impossible without needing a dedupe pass.
 */
function upnToNameFragment(upn: string, maxLength: number): string {
  const localPart = upn.trim().toLowerCase().split('@')[0];
  const sanitized = localPart
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/[-.]{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, maxLength)
    .replace(/[-.]+$/g, '');
  // A UPN of only illegal characters would otherwise yield an invalid empty name.
  return sanitized || 'user';
}

function roleBindingName(upn: string, clusterRole: string, position: number): string {
  const suffix = `-${clusterRole}-${position}`;
  const fragment = upnToNameFragment(upn, DNS_LABEL_MAX_LENGTH - suffix.length);
  return `${fragment}${suffix}`;
}

export function generateNamespaceManifestEntries(
  options: GenerateNamespaceManifestOptions
): NamespaceManifestEntry[] {
  const {
    namespaceName,
    cpuRequest,
    cpuLimit,
    memoryRequest,
    memoryLimit,
    ingressPolicy,
    egressPolicy,
    labels = {},
    annotations = {},
    userAssignments = [],
    includeRoleBindings = true,
  } = options;

  const entries: NamespaceManifestEntry[] = [];

  // --- 1. Namespace ---------------------------------------------------------
  const namespaceMeta: Record<string, unknown> = { name: namespaceName };
  if (Object.keys(labels).length > 0) {
    namespaceMeta.labels = { ...labels };
  }
  if (Object.keys(annotations).length > 0) {
    namespaceMeta.annotations = { ...annotations };
  }

  entries.push({
    comment: 'Namespace',
    resource: {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: namespaceMeta,
    },
  });

  // --- 2. ResourceQuota -----------------------------------------------------
  const quotaHard: Record<string, string> = {};
  if (cpuRequest !== undefined) quotaHard['requests.cpu'] = `${cpuRequest}m`;
  if (cpuLimit !== undefined) quotaHard['limits.cpu'] = `${cpuLimit}m`;
  if (memoryRequest !== undefined) quotaHard['requests.memory'] = `${memoryRequest}Mi`;
  if (memoryLimit !== undefined) quotaHard['limits.memory'] = `${memoryLimit}Mi`;

  if (Object.keys(quotaHard).length > 0) {
    entries.push({
      comment: 'ResourceQuota',
      resource: {
        apiVersion: 'v1',
        kind: 'ResourceQuota',
        metadata: {
          name: `${namespaceName}-quota`,
          namespace: namespaceName,
        },
        spec: {
          hard: quotaHard,
        },
      },
    });
  }

  // --- 3. NetworkPolicy -----------------------------------------------------
  const ingress = buildPolicyRule(ingressPolicy, 'ingress', namespaceName);
  const egress = buildPolicyRule(egressPolicy, 'egress', namespaceName);

  if (ingress.include || egress.include) {
    const policyTypes: string[] = [];
    if (ingress.include) policyTypes.push('Ingress');
    if (egress.include) policyTypes.push('Egress');

    const spec: Record<string, unknown> = {
      podSelector: {},
      policyTypes,
    };
    if (ingress.include) spec.ingress = ingress.rules;
    if (egress.include) spec.egress = egress.rules;

    entries.push({
      comment: 'NetworkPolicy',
      resource: {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: {
          name: `${namespaceName}-network-policy`,
          namespace: namespaceName,
        },
        spec,
      },
    });
  }

  // --- 4. RoleBindings ------------------------------------------------------
  // Only assignments carrying a UPN can be bound: it is the name the apiserver
  // sees for the user, and there is no fallback — an object ID here would bind a
  // subject that matches nothing. Callers validate this up front, so anything
  // dropped at this point would already have been reported.
  const validAssignments = includeRoleBindings ? userAssignments.filter(a => !!a.upn?.trim()) : [];
  validAssignments.forEach((assignment, index) => {
    const clusterRole = mapUIRoleToClusterRole(assignment.role);
    entries.push({
      comment: `RoleBinding (${assignment.role})`,
      resource: {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'RoleBinding',
        metadata: {
          name: roleBindingName(assignment.upn!, clusterRole, index + 1),
          namespace: namespaceName,
        },
        subjects: [
          {
            kind: 'User',
            name: assignment.upn!.trim(),
            apiGroup: 'rbac.authorization.k8s.io',
          },
        ],
        roleRef: {
          kind: 'ClusterRole',
          name: clusterRole,
          apiGroup: 'rbac.authorization.k8s.io',
        },
      },
    });
  });

  return entries;
}

/**
 * Returns the generated Kubernetes objects (in apply order) for the given
 * options. Use this when applying the manifest via the Kubernetes API; use
 * {@link generateNamespaceManifestYaml} for a human-readable preview.
 *
 * @param options - See {@link GenerateNamespaceManifestOptions}.
 */
export function generateNamespaceManifestObjects(
  options: GenerateNamespaceManifestOptions
): Record<string, unknown>[] {
  return generateNamespaceManifestEntries(options).map(e => e.resource);
}

/**
 * Generates a multi-document Kubernetes YAML manifest (each resource separated
 * by `---`, prefixed with a `# <kind>` comment) that reproduces the
 * capabilities of an AKS managed namespace as native Kubernetes objects.
 *
 * @param options - See {@link GenerateNamespaceManifestOptions}.
 * @returns A YAML string with each resource separated by `---`.
 */
export function generateNamespaceManifestYaml(options: GenerateNamespaceManifestOptions): string {
  return generateNamespaceManifestEntries(options)
    .map(({ comment, resource }) => `# ${comment}\n${YAML.stringify(resource).trim()}`)
    .join('\n---\n');
}
