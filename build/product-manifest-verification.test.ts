// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  legalDocumentIdentitiesMatch,
  pluginIdentitiesMatch,
  productIdentityMatches,
} from './product-manifest-verification';

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

test('compares configured plugin identities without depending on order', () => {
  const plugins = [
    { name: 'aks-desktop', packageName: 'aks-desktop' },
    { name: 'catalog', packageName: '@headlamp-k8s/plugin-catalog' },
  ];
  assert.equal(pluginIdentitiesMatch([...plugins].reverse(), plugins), true);
  assert.equal(
    pluginIdentitiesMatch(
      [{ name: 'replacement', packageName: 'replacement' }, plugins[1]],
      plugins
    ),
    false
  );
  assert.equal(pluginIdentitiesMatch(undefined, undefined), false);
});

test('compares configured legal document IDs and files', () => {
  const documents = [
    { id: 'license', file: 'LICENSE.txt' },
    { id: 'notices', file: 'NOTICE.md' },
  ];
  assert.equal(legalDocumentIdentitiesMatch([...documents].reverse(), documents), true);
  assert.equal(
    legalDocumentIdentitiesMatch(
      [{ id: 'privacy', file: 'PRIVACY.md' }, documents[1]],
      documents
    ),
    false
  );
  assert.equal(legalDocumentIdentitiesMatch(undefined, undefined), false);
});
