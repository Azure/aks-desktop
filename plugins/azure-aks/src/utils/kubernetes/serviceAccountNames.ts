// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { normalizeK8sName } from './k8sNames';

/**
 * Derives a Kubernetes ServiceAccount name from an application name.
 * Normalizes to lowercase alphanumeric + hyphens, max 63 chars.
 */
export function getServiceAccountName(appName: string): string {
  return normalizeK8sName(`${appName}-sa`) || 'app-sa';
}
