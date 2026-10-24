// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import bridgeConfig from './local-plugin.vitest.config.mts';

export default {
  ...bridgeConfig,
  test: {
    ...bridgeConfig.test,
    include: ['test/integration/local-discovery.spec.ts'],
    testTimeout: 90000,
  },
};
