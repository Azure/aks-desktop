// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import type { FormData } from './types';
import { validateBasicsStep, validateForm } from './validators';

/**
 * Minimal valid form data for the basics step.
 * All required fields are set so no errors are produced by default.
 */
const validFormData: Pick<FormData, 'projectName' | 'subscription' | 'cluster' | 'resourceGroup'> =
  {
    projectName: 'my-project',
    subscription: 'sub-123',
    cluster: 'my-cluster',
    resourceGroup: 'my-rg',
  };

/** A capabilities object with all features fully enabled. */
const allFeaturesEnabled: ClusterCapabilities = {
  sku: 'Automatic',
  aadEnabled: true,
  azureRbacEnabled: true,
  networkPolicy: 'cilium',
  networkPlugin: 'azure',
  prometheusEnabled: true,
  containerInsightsEnabled: true,
  kedaEnabled: true,
  vpaEnabled: true,
};

/** Default non-error prerequisites for basics step. */
const namespaceExists = false;
const checkingNamespace = false;
const namespaceError = null;
const isClusterMissing = false;

describe('validateBasicsStep Arc (AKS Hybrid & Edge) accessibility gating', () => {
  const isArc = true;

  it('blocks the step while the accessibility probe is running', () => {
    const result = validateBasicsStep(
      validFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      false, // isClusterMissing
      null, // capabilities
      isArc,
      true, // arcAccessChecking
      null // arcAccessible
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Checking cluster accessibility')])
    );
  });

  it('blocks the step when the Arc cluster is unreachable', () => {
    const result = validateBasicsStep(
      validFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      false,
      null,
      isArc,
      false, // arcAccessChecking
      false // arcAccessible
    );
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('not accessible')])
    );
  });

  it('allows the step when the Arc cluster is reachable', () => {
    const result = validateBasicsStep(
      validFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      false,
      null,
      isArc,
      false,
      true // arcAccessible
    );
    expect(result.isValid).toBe(true);
  });

  it('does not apply the accessibility gate to managed (non-Arc) clusters', () => {
    const result = validateBasicsStep(
      validFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      false,
      null,
      false, // isArc
      false,
      false // arcAccessible — ignored for managed clusters
    );
    expect(result.isValid).toBe(true);
  });
});

describe('validateBasicsStep with capabilities', () => {
  it('returns warnings when capabilities has no network policy (networkPolicy: "none")', () => {
    const capabilities: ClusterCapabilities = {
      ...allFeaturesEnabled,
      networkPolicy: 'none',
    };

    const result = validateBasicsStep(
      validFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      isClusterMissing,
      capabilities
    );

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('network policy')])
    );
    // This should be a warning, not an error
    expect(result.errors).not.toEqual(
      expect.arrayContaining([expect.stringContaining('network policy')])
    );
  });

  it('returns warnings when capabilities has null network policy', () => {
    const capabilities: ClusterCapabilities = {
      ...allFeaturesEnabled,
      networkPolicy: null,
    };

    const result = validateBasicsStep(
      validFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      isClusterMissing,
      capabilities
    );

    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('network policy')])
    );
  });

  it('returns warnings when capabilities has prometheusEnabled: false', () => {
    const capabilities: ClusterCapabilities = {
      ...allFeaturesEnabled,
      prometheusEnabled: false,
    };

    const result = validateBasicsStep(
      validFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      isClusterMissing,
      capabilities
    );

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Prometheus')])
    );
    // This should be a warning, not an error
    expect(result.errors).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Prometheus')])
    );
  });

  it('returns warnings when capabilities has prometheusEnabled: null', () => {
    const capabilities: ClusterCapabilities = {
      ...allFeaturesEnabled,
      prometheusEnabled: null,
    };

    const result = validateBasicsStep(
      validFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      isClusterMissing,
      capabilities
    );

    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Prometheus')])
    );
  });

  it('warnings do NOT affect isValid - form should still be valid when only warnings are present', () => {
    const capabilities: ClusterCapabilities = {
      ...allFeaturesEnabled,
      networkPolicy: 'none',
      prometheusEnabled: false,
    };

    const result = validateBasicsStep(
      validFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      isClusterMissing,
      capabilities
    );

    // Should have warnings
    expect(result.warnings).toHaveLength(2);

    // But form should still be valid (no errors)
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns no warnings when capabilities is null', () => {
    const result = validateBasicsStep(
      validFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      isClusterMissing,
      null
    );

    expect(result.warnings).toHaveLength(0);
  });

  it('returns no warnings when capabilities is undefined', () => {
    const result = validateBasicsStep(
      validFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      isClusterMissing,
      undefined
    );

    expect(result.warnings).toHaveLength(0);
  });

  it('returns no warnings when capabilities has all features enabled', () => {
    const result = validateBasicsStep(
      validFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      isClusterMissing,
      allFeaturesEnabled
    );

    expect(result.warnings).toHaveLength(0);
    expect(result.isValid).toBe(true);
  });

  it('warnings array is returned in the result alongside errors', () => {
    const capabilities: ClusterCapabilities = {
      ...allFeaturesEnabled,
      networkPolicy: 'none',
    };

    const result = validateBasicsStep(
      validFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      isClusterMissing,
      capabilities
    );

    // Result should have both errors and warnings properties
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('isValid');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('can have both errors and warnings at the same time', () => {
    const invalidFormData = {
      ...validFormData,
      projectName: '', // Will produce an error
    };

    const capabilities: ClusterCapabilities = {
      ...allFeaturesEnabled,
      networkPolicy: 'none', // Will produce a warning
    };

    const result = validateBasicsStep(
      invalidFormData,
      namespaceExists,
      checkingNamespace,
      namespaceError,
      isClusterMissing,
      capabilities
    );

    // Should have both errors and warnings
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    // And isValid should be false due to the errors
    expect(result.isValid).toBe(false);
  });

  it('does not produce warnings for other network policy values like calico or azure', () => {
    for (const policy of ['calico', 'cilium', 'azure'] as const) {
      const capabilities: ClusterCapabilities = {
        ...allFeaturesEnabled,
        networkPolicy: policy,
      };

      const result = validateBasicsStep(
        validFormData,
        namespaceExists,
        checkingNamespace,
        namespaceError,
        isClusterMissing,
        capabilities
      );

      expect(result.warnings).toHaveLength(0);
    }
  });

  it('passes validation for a complete form with no preflight gates required', () => {
    const result = validateBasicsStep(
      {
        projectName: 'my-project',
        subscription: 'sub-id',
        cluster: 'my-cluster',
        resourceGroup: 'my-rg',
      },
      false, // namespaceExists
      false, // checkingNamespace
      null, // namespaceError
      undefined,
      null
    );

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('assignee validation', () => {
  const OID = '38927c93-a0fd-4b06-b21a-69b8ed1e208c';
  const UPN = 'sannagaraj@microsoft.com';

  /** Builds full form data so only assignment errors can surface. */
  const formWith = (userAssignments: FormData['userAssignments']): FormData =>
    ({
      ...validFormData,
      description: '',
      ingress: 'AllowSameNamespace',
      egress: 'AllowAll',
      cpuRequest: 2000,
      memoryRequest: 4096,
      cpuLimit: 2000,
      memoryLimit: 4096,
      userAssignments,
    } as FormData);

  const assignmentErrors = (
    userAssignments: FormData['userAssignments'],
    isArc?: boolean
  ): string[] => validateForm(formWith(userAssignments), isArc).fieldErrors.assignments ?? [];

  it('requires an object ID, since a sign-in name alone cannot be granted', () => {
    // Managed namespaces key their role assignments on the object ID, and Arc
    // needs it for the connectivity role every project grants. Without it the
    // managed path filters the assignee out silently and the Arc path reports a
    // failure — both after the project already exists.
    expect(assignmentErrors([{ objectId: OID, role: 'Writer' }])).toEqual([]);
    expect(assignmentErrors([{ objectId: '', upn: UPN, role: 'Writer' }])[0]).toMatch(
      /valid Azure AD object ID/i
    );
  });

  it('rejects an assignee with neither identifier', () => {
    expect(assignmentErrors([{ objectId: '  ', role: 'Writer' }])[0]).toMatch(/select a user/i);
  });

  it('rejects a malformed identifier', () => {
    expect(assignmentErrors([{ objectId: 'not-a-uuid', role: 'Writer' }])[0]).toMatch(
      /valid Azure AD object ID/i
    );
  });

  it('requires a sign-in name when the grant is a RoleBinding', () => {
    // The RoleBinding subject must be the UPN; an object ID grants nothing.
    expect(assignmentErrors([{ objectId: OID, role: 'Writer' }], true)[0]).toMatch(/sign-in name/i);
  });

  it('accepts an object-ID-only assignee when the grant is an Azure role assignment', () => {
    // Covers managed AKS and Arc clusters using Azure RBAC — both key on the
    // object ID, so demanding a UPN there would block a valid assignee.
    expect(assignmentErrors([{ objectId: OID, role: 'Writer' }], false)).toEqual([]);
  });

  it('accepts an assignee carrying both identifiers under either model', () => {
    expect(assignmentErrors([{ objectId: OID, upn: UPN, role: 'Writer' }], true)).toEqual([]);
    expect(assignmentErrors([{ objectId: OID, upn: UPN, role: 'Writer' }], false)).toEqual([]);
  });

  it('treats an empty assignment list as valid', () => {
    expect(assignmentErrors([])).toEqual([]);
  });
});
