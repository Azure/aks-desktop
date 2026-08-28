// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { runPlugin } from '../../../../../node_modules/@headlamp-k8s/headlamp-source/source/frontend/src/plugin/runPlugin';
import { getStartClusterProxyCapability } from './aksHybridEdgeProxy';

declare global {
  var __aksProxyCapability: ((target: unknown) => Promise<unknown>) | undefined;
  var __aksProxyResult: Promise<unknown> | undefined;
}

describe('AKS Desktop proxy capability integration', () => {
  afterEach(() => {
    delete globalThis.__aksProxyCapability;
    delete globalThis.__aksProxyResult;
  });

  test('uses the private capability passed by the Headlamp plugin loader', async () => {
    const desktopStartClusterProxy = vi.fn().mockResolvedValue({ success: true });
    const errors: unknown[] = [];
    const target = {
      cluster: 'cluster-a',
      subscriptionId: 'sub-a',
      resourceGroup: 'rg-a',
    };
    const source = `
      globalThis.__aksProxyCapability = (${getStartClusterProxyCapability.toString()})();
      globalThis.__aksProxyResult = globalThis.__aksProxyCapability(${JSON.stringify(target)});
    `;

    runPlugin(
      source,
      'aks-desktop',
      '0.9.0',
      error => errors.push(error),
      Function,
      ['startClusterProxy'],
      [desktopStartClusterProxy]
    );

    expect(errors).toEqual([]);
    await expect(globalThis.__aksProxyResult).resolves.toEqual({ success: true });
    expect(desktopStartClusterProxy).toHaveBeenCalledWith(target);
  });

  test('does not recover the capability when Headlamp does not inject it', () => {
    const errors: unknown[] = [];
    const source = `
      globalThis.__aksProxyCapability = (${getStartClusterProxyCapability.toString()})();
    `;

    runPlugin(source, 'other-plugin', '1.0.0', error => errors.push(error), Function, [], []);

    expect(errors).toEqual([]);
    expect(globalThis.__aksProxyCapability).toBeUndefined();
  });
});