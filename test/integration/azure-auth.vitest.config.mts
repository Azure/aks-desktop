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
      vitest: path.join(path.dirname(appRequire.resolve('vitest/package.json')), 'dist/index.js'),
      electron: appRequire.resolve('electron'),
    },
  },
  test: {
    include: ['test/integration/azure-auth.spec.ts'],
    environment: 'node',
    server: { deps: { inline: [/headlamp-source[/\\]source/] } },
  },
};
