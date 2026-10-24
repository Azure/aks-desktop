// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const app = path.join(root, 'node_modules/@headlamp-k8s/headlamp-source/source/app');
const appRequire = createRequire(path.join(app, 'package.json'));

export default {
  root,
  resolve: {
    alias: {
      vitest: appRequire.resolve('vitest/dist/index.js'),
      electron: appRequire.resolve('electron'),
      'cross-spawn': appRequire.resolve('cross-spawn'),
    },
  },
  test: {
    include: ['test/integration/local-plugin.spec.ts'],
    environment: 'node',
    testTimeout: 30000,
    server: {
      deps: { inline: [/headlamp-source[/\\]source/] },
    },
  },
};
