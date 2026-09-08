// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
const AZ_RESOURCE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
export function isValidAzResourceName(value: string): boolean {
  return AZ_RESOURCE_NAME_PATTERN.test(value);
}

// Validates GitHub owner/repo/branch names (no path traversal or shell metacharacters)
const GITHUB_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/;
export function isValidGitHubName(value: string): boolean {
  return GITHUB_NAME_PATTERN.test(value);
}

export interface ManagedIdentityResult {
  success: boolean;
  notFound?: boolean;
  clientId?: string;
  principalId?: string;
  tenantId?: string;
  error?: string;
}

export function parseManagedIdentityOutput(stdout: string) {
  let identity;
  try {
    identity = JSON.parse(stdout);
  } catch {
    throw new Error('Unexpected output from az identity command');
  }
  return {
    clientId: identity.clientId as string,
    principalId: identity.principalId as string,
    tenantId: identity.tenantId as string,
  };
}
