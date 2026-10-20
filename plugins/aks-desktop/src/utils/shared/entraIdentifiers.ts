// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Pure predicates for the two ways an Entra user is named.
 *
 * Both identifiers are needed and neither substitutes for the other: Azure role
 * assignments key on the **object ID**, while a Kubernetes RoleBinding subject on
 * an Arc cluster must be the **UPN** — the apiserver receives the object ID only
 * as an unmatched `Extra: oid` attribute.
 *
 * Kept dependency-free so both the Azure CLI helpers and the form validators can
 * use them without pulling one layer into the other.
 */

const OBJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UPN is an email-shaped string (e.g. `someone@contoso.com`). */
const UPN_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when the value is a well-formed Entra object ID (UUID). */
export function isEntraObjectId(value: string | undefined): boolean {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value.trim());
}

/** True when the value looks like an Entra user principal name. */
export function isUserPrincipalName(value: string | undefined): boolean {
  return typeof value === 'string' && UPN_PATTERN.test(value.trim());
}
