// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** DNS-1123 label pattern: lowercase alphanumeric and hyphens, 1-63 chars. */
export const K8S_DNS_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Sanitize a string for use as a Kubernetes label *value*.
 * Allows alphanumeric, `.`, `_`, `-` (unlike normalizeK8sName which targets DNS-1123 names).
 * Ensures the result starts and ends with an alphanumeric character (K8s label value rule)
 * and returns a fallback if the sanitized result is empty.
 */
export function sanitizeLabelValue(value: string, fallback = 'app'): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 63)
    .replace(/^[^a-zA-Z0-9]+/, '')
    .replace(/[^a-zA-Z0-9]+$/, '');
  return sanitized || fallback;
}

/**
 * Sanitize a string to lowercase alphanumeric + hyphens with configurable max length.
 * Used by both K8s DNS-1123 names (63 chars) and Azure identity names (128 chars).
 */
export function sanitizeDnsName(raw: string, maxLength = 63, fallback = 'app'): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLength)
      .replace(/-+$/g, '') || fallback
  );
}

/** Normalize a string to DNS-1123 label constraints (lowercase alnum/`-`, max 63 chars). */
export function normalizeK8sName(raw: string): string {
  return sanitizeDnsName(raw);
}
