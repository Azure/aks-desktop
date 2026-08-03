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
      { objectId: '11111111-1111-1111-1111-111111111111', role: 'Admin' },
      { objectId: '22222222-2222-2222-2222-222222222222', role: 'Reader' },
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
    expect(bindings[0].subjects[0].name).toBe('11111111-1111-1111-1111-111111111111');
    expect(bindings[1].roleRef.name).toBe('view');
  });

  it('skips assignments with empty object IDs', () => {
    const yaml = generateNamespaceManifestYaml({
      namespaceName: 'x',
      userAssignments: [{ objectId: '  ', role: 'Writer' }],
    });
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
    userAssignments: [{ objectId: '11111111-1111-1111-1111-111111111111', role: 'Admin' }],
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
