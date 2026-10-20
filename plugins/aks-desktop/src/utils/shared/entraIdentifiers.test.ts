// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, test } from 'vitest';
import { isEntraObjectId, isUserPrincipalName } from './entraIdentifiers';

describe('isEntraObjectId', () => {
  test('accepts a well-formed object ID in either case, ignoring surrounding space', () => {
    expect(isEntraObjectId('38927c93-a0fd-4b06-b21a-69b8ed1e208c')).toBe(true);
    expect(isEntraObjectId('38927C93-A0FD-4B06-B21A-69B8ED1E208C')).toBe(true);
    expect(isEntraObjectId('  38927c93-a0fd-4b06-b21a-69b8ed1e208c  ')).toBe(true);
  });

  test('rejects anything else', () => {
    expect(isEntraObjectId('not-a-uuid')).toBe(false);
    expect(isEntraObjectId('sannagaraj@microsoft.com')).toBe(false);
    expect(isEntraObjectId('')).toBe(false);
    expect(isEntraObjectId(undefined)).toBe(false);
  });
});

describe('isUserPrincipalName', () => {
  test('accepts an email-shaped sign-in name', () => {
    expect(isUserPrincipalName('sannagaraj@microsoft.com')).toBe(true);
    expect(isUserPrincipalName('  ada.lovelace@contoso.co.uk ')).toBe(true);
  });

  test('rejects an object ID — the two are never interchangeable', () => {
    expect(isUserPrincipalName('38927c93-a0fd-4b06-b21a-69b8ed1e208c')).toBe(false);
  });

  test('rejects malformed values', () => {
    expect(isUserPrincipalName('someone@localhost')).toBe(false);
    expect(isUserPrincipalName('someone')).toBe(false);
    expect(isUserPrincipalName('a b@c.com')).toBe(false);
    expect(isUserPrincipalName('')).toBe(false);
    expect(isUserPrincipalName(undefined)).toBe(false);
  });
});
