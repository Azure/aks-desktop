// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import {
  generateNamespaceManifestObjects,
  generateNamespaceManifestYaml,
  mapUIRoleToClusterRole,
} from './namespaceManifest';

/** Parses the multi-document YAML output into an array of resource objects. */
function parseDocs(yaml: string): any[] {
  return YAML.parseAllDocuments(yaml).map(d => d.toJSON());
}

describe('mapUIRoleToClusterRole', () => {
  it('maps known UI roles to built-in ClusterRoles', () => {
    expect(mapUIRoleToClusterRole('Admin')).toBe('admin');
    expect(mapUIRoleToClusterRole('Writer')).toBe('edit');
    expect(mapUIRoleToClusterRole('Reader')).toBe('view');
  });

  it('falls back to view for unknown roles', () => {
    expect(mapUIRoleToClusterRole('Unknown')).toBe('view');
  });
});

describe('generateNamespaceManifestYaml', () => {
  const baseOptions = {
    namespaceName: 'my-project',
    cpuRequest: 2000,
    cpuLimit: 4000,
    memoryRequest: 4096,
    memoryLimit: 8192,
    ingressPolicy: 'AllowSameNamespace' as const,
    egressPolicy: 'AllowAll' as const,
    labels: {
      'headlamp.dev/project-id': 'my-project',
      'headlamp.dev/project-managed-by': 'aks-desktop',
    },
    annotations: { 'headlamp.dev/project-description': 'demo' },
    userAssignments: [
      { objectId: '11111111-1111-1111-1111-111111111111', upn: 'ada@contoso.com', role: 'Admin' },
      {
        objectId: '22222222-2222-2222-2222-222222222222',
        upn: 'grace@contoso.com',
        role: 'Reader',
      },
    ],
  };

  it('produces a Namespace with labels and annotations', () => {
    const docs = parseDocs(generateNamespaceManifestYaml(baseOptions));
    const ns = docs.find(d => d.kind === 'Namespace');
    expect(ns).toBeDefined();
    expect(ns.metadata.name).toBe('my-project');
    expect(ns.metadata.labels['headlamp.dev/project-id']).toBe('my-project');
    expect(ns.metadata.annotations['headlamp.dev/project-description']).toBe('demo');
  });

  it('produces a ResourceQuota with converted units', () => {
    const docs = parseDocs(generateNamespaceManifestYaml(baseOptions));
    const quota = docs.find(d => d.kind === 'ResourceQuota');
    expect(quota.spec.hard).toEqual({
      'requests.cpu': '2000m',
      'limits.cpu': '4000m',
      'requests.memory': '4096Mi',
      'limits.memory': '8192Mi',
    });
  });

  it('emits no LimitRange (parity with AKS managed namespaces)', () => {
    // AKS managed namespaces create only a ResourceQuota, not a LimitRange.
    const docs = parseDocs(generateNamespaceManifestYaml(baseOptions));
    expect(docs.find(d => d.kind === 'LimitRange')).toBeUndefined();
  });

  it('maps ingress AllowSameNamespace and egress AllowAll into the NetworkPolicy', () => {
    const docs = parseDocs(generateNamespaceManifestYaml(baseOptions));
    const np = docs.find(d => d.kind === 'NetworkPolicy');
    expect(np.spec.policyTypes).toEqual(['Ingress', 'Egress']);
    expect(np.spec.ingress).toEqual([
      {
        from: [
          { namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'my-project' } } },
        ],
      },
    ]);
    expect(np.spec.egress).toEqual([{}]);
  });

  it('emits an empty rule list for DenyAll', () => {
    const yaml = generateNamespaceManifestYaml({
      namespaceName: 'deny',
      ingressPolicy: 'DenyAll',
      egressPolicy: 'DenyAll',
    });
    const np = parseDocs(yaml).find(d => d.kind === 'NetworkPolicy');
    expect(np.spec.policyTypes).toEqual(['Ingress', 'Egress']);
    expect(np.spec.ingress).toEqual([]);
    expect(np.spec.egress).toEqual([]);
  });

  it('creates one RoleBinding per valid assignment with mapped ClusterRoles', () => {
    const docs = parseDocs(generateNamespaceManifestYaml(baseOptions));
    const bindings = docs.filter(d => d.kind === 'RoleBinding');
    expect(bindings).toHaveLength(2);
    expect(bindings[0].roleRef.name).toBe('admin');
    expect(bindings[1].roleRef.name).toBe('view');
  });

  it('names each RoleBinding after the user, role and position', () => {
    const docs = parseDocs(generateNamespaceManifestYaml(baseOptions));
    const bindings = docs.filter(d => d.kind === 'RoleBinding');
    expect(bindings.map(b => b.metadata.name)).toEqual(['ada-admin-1', 'grace-view-2']);
  });

  it('reserves space for the role and position within the DNS label limit', () => {
    const yaml = generateNamespaceManifestYaml({
      namespaceName: 'ns',
      userAssignments: [{ objectId: 'x', upn: `${'a'.repeat(80)}@contoso.com`, role: 'Writer' }],
    });
    const name = parseDocs(yaml).find(d => d.kind === 'RoleBinding').metadata.name;

    expect(name).toBe(`${'a'.repeat(56)}-edit-1`);
    expect(name).toHaveLength(63);
    expect(name).toMatch(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
  });

  it('folds characters Entra allows but Kubernetes names forbid', () => {
    // Guest accounts are the awkward case: `_` and `#` are legal in a UPN and
    // illegal in an RFC 1123 subdomain.
    const yaml = generateNamespaceManifestYaml({
      namespaceName: 'ns',
      userAssignments: [
        { objectId: 'x', upn: 'Someone_gmail.com#EXT#@contoso.onmicrosoft.com', role: 'Writer' },
      ],
    });
    const name = parseDocs(yaml).find(d => d.kind === 'RoleBinding').metadata.name;
    expect(name).toBe('someone-gmail.com-ext-edit-1');
    expect(name).toMatch(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
  });

  it('names the subject by UPN — the object ID would match nothing', () => {
    const docs = parseDocs(generateNamespaceManifestYaml(baseOptions));
    const bindings = docs.filter(d => d.kind === 'RoleBinding');
    expect(bindings[0].subjects[0]).toMatchObject({ kind: 'User', name: 'ada@contoso.com' });
    expect(bindings[1].subjects[0].name).toBe('grace@contoso.com');
  });

  it('skips assignments with no UPN rather than binding an unmatched subject', () => {
    // The apiserver never sees the object ID as a username, so a binding naming it
    // would apply cleanly and grant nothing.
    const yaml = generateNamespaceManifestYaml({
      namespaceName: 'x',
      userAssignments: [{ objectId: '11111111-1111-1111-1111-111111111111', role: 'Writer' }],
    });
    const bindings = parseDocs(yaml).filter(d => d.kind === 'RoleBinding');
    expect(bindings).toHaveLength(0);
  });

  it('skips assignments with empty object IDs', () => {
    const yaml = generateNamespaceManifestYaml({
      namespaceName: 'x',
      userAssignments: [{ objectId: '  ', role: 'Writer' }],
    });
    const bindings = parseDocs(yaml).filter(d => d.kind === 'RoleBinding');
    expect(bindings).toHaveLength(0);
  });

  it('omits RoleBindings entirely when the cluster authorizes through Azure RBAC', () => {
    const yaml = generateNamespaceManifestYaml({ ...baseOptions, includeRoleBindings: false });
    const bindings = parseDocs(yaml).filter(d => d.kind === 'RoleBinding');
    expect(bindings).toHaveLength(0);
  });

  it('omits optional resources when no inputs are provided', () => {
    const docs = parseDocs(generateNamespaceManifestYaml({ namespaceName: 'minimal' }));
    const kinds = docs.map(d => d.kind);
    expect(kinds).toEqual(['Namespace']);
  });
});

describe('generateNamespaceManifestObjects', () => {
  const baseOptions = {
    namespaceName: 'my-project',
    cpuRequest: 2000,
    cpuLimit: 4000,
    memoryRequest: 4096,
    memoryLimit: 8192,
    ingressPolicy: 'AllowSameNamespace' as const,
    egressPolicy: 'AllowAll' as const,
    labels: { 'headlamp.dev/project-id': 'my-project' },
    userAssignments: [
      { objectId: '11111111-1111-1111-1111-111111111111', upn: 'ada@contoso.com', role: 'Admin' },
    ],
  };

  it('returns plain objects in apply order (Namespace first)', () => {
    const objs = generateNamespaceManifestObjects(baseOptions);
    expect(objs.map(o => o.kind)).toEqual([
      'Namespace',
      'ResourceQuota',
      'NetworkPolicy',
      'RoleBinding',
    ]);
  });

  it('matches the parsed YAML output document-for-document', () => {
    const objs = generateNamespaceManifestObjects(baseOptions);
    const docs = YAML.parseAllDocuments(generateNamespaceManifestYaml(baseOptions)).map(d =>
      d.toJSON()
    );
    expect(objs).toEqual(docs);
  });

  it('emits only a Namespace when no optional inputs are provided', () => {
    const objs = generateNamespaceManifestObjects({ namespaceName: 'minimal' });
    expect(objs.map(o => o.kind)).toEqual(['Namespace']);
  });
});
