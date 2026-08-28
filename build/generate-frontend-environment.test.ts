// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  generateFrontendEnvironment,
  serializeFrontendEnvironment,
} from './generate-frontend-environment';

test('generates sorted public frontend product environment values', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aks-frontend-env-'));
  const frontendDir = path.join(
    rootDir,
    'node_modules',
    '@headlamp-k8s',
    'headlamp-source',
    'source',
    'frontend'
  );
  fs.mkdirSync(frontendDir, { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    JSON.stringify({
      headlamp: {
        build: {
          frontendEnvironment: {
            REACT_APP_HEADLAMP_NOT_FOUND_PAGE_TITLE: 'Page not found in AKS Desktop',
            REACT_APP_HEADLAMP_ERROR_PAGE_TITLE: 'AKS Desktop encountered an error',
          },
        },
      },
    })
  );

  try {
    const outputPath = generateFrontendEnvironment(rootDir);
    assert.equal(outputPath, path.join(frontendDir, '.env.local'));
    assert.equal(
      fs.readFileSync(outputPath, 'utf8'),
      'REACT_APP_HEADLAMP_ERROR_PAGE_TITLE="AKS Desktop encountered an error"\n' +
        'REACT_APP_HEADLAMP_NOT_FOUND_PAGE_TITLE="Page not found in AKS Desktop"\n'
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('rejects private keys and multiline values', () => {
  assert.throws(
    () => serializeFrontendEnvironment({ HEADLAMP_BACKEND_TOKEN: 'secret' }),
    /must start with REACT_APP_/
  );
  assert.throws(
    () => serializeFrontendEnvironment({ REACT_APP_HEADLAMP_ERROR_PAGE_TITLE: 'line 1\nline 2' }),
    /single-line string/
  );
});
