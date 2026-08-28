// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import test from 'node:test';
import { productIdentityMatches } from './product-manifest-verification';

const expected = {
  name: 'aks-desktop',
  productName: 'AKS Desktop',
  version: '0.9.0',
};

test('accepts the configured packaged product identity', () => {
  assert.equal(productIdentityMatches(expected, expected), true);
});

test('rejects stale packaged product versions', () => {
  assert.equal(
    productIdentityMatches({ ...expected, version: '0.8.0' }, expected),
    false
  );
});

test('rejects mismatched product names and missing identities', () => {
  assert.equal(
    productIdentityMatches({ ...expected, productName: 'Headlamp' }, expected),
    false
  );
  assert.equal(productIdentityMatches(undefined, expected), false);
});
