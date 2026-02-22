// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import type { FormData } from './types';
import { validateBasicsStep } from './validators';

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
const extensionInstalled = true;
const featureRegistered = true;
const namespaceExists = false;
const checkingNamespace = false;
const namespaceError = null;
const isClusterMissing = false;

describe('validateBasicsStep with capabilities', () => {
  it('returns warnings when capabilities has no network policy (networkPolicy: "none")', () => {
    const capabilities: ClusterCapabilities = {
      ...allFeaturesEnabled,
      networkPolicy: 'none',
    };

    const result = validateBasicsStep(
      validFormData,
      extensionInstalled,
      featureRegistered,
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
      extensionInstalled,
      featureRegistered,
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
      extensionInstalled,
      featureRegistered,
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
      extensionInstalled,
      featureRegistered,
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
      extensionInstalled,
      featureRegistered,
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
      extensionInstalled,
      featureRegistered,
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
      extensionInstalled,
      featureRegistered,
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
      extensionInstalled,
      featureRegistered,
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
      extensionInstalled,
      featureRegistered,
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
      extensionInstalled,
      featureRegistered,
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
        extensionInstalled,
        featureRegistered,
        namespaceExists,
        checkingNamespace,
        namespaceError,
        isClusterMissing,
        capabilities
      );

      expect(result.warnings).toHaveLength(0);
    }
  });
});
