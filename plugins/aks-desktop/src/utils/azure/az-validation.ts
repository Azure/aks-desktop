// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
const AZ_RESOURCE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
export function isValidAzResourceName(value: string): boolean {
  return AZ_RESOURCE_NAME_PATTERN.test(value);
}

// Resource groups allow ARM's ^[-\w\._\(\)]+$ (.NET \w = L, Mn, Nd, Pc), 1-90 chars, no trailing period.
// https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules#microsoftresources
const INVALID_RESOURCE_GROUP_CHARACTER = /[^\p{L}\p{Mn}\p{Nd}\p{Pc}().-]/u;
export function isValidAzResourceGroupName(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 90 &&
    !value.endsWith('.') &&
    !INVALID_RESOURCE_GROUP_CHARACTER.test(value)
  );
}

// Validates GitHub owner/repo names (no path traversal or shell metacharacters)
const GITHUB_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/;
export function isValidGitHubName(value: string): boolean {
  return GITHUB_NAME_PATTERN.test(value);
}

// Validates Git branch refs (allows '/' for hierarchical branches like release/deploy, no traversal/lock segments)
const GIT_BRANCH_PATTERN = /^[a-zA-Z0-9._/-]{1,255}$/;
export function isValidGitBranchName(value: string): boolean {
  if (!GIT_BRANCH_PATTERN.test(value)) return false;
  if (
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.startsWith('.') ||
    value.endsWith('.') ||
    value.includes('..') ||
    value.includes('//')
  ) {
    return false;
  }
  return value
    .split('/')
    .every(segment => segment.length > 0 && !segment.startsWith('.') && !segment.endsWith('.lock'));
}
