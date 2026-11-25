// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { EventEmitter } from 'node:events';
import { afterEach, expect, test, vi } from 'vitest';
import {
  AZURE_OAUTH_START,
  AZURE_OAUTH_STATUS,
  AZURE_OAUTH_TOKEN,
  setupAzureOAuth,
} from '../../node_modules/@headlamp-k8s/headlamp-source/source/app/electron/azureOAuth';
import {
  ARM_SCOPE,
  getSubscriptionCredential,
} from '../../plugins/aks-desktop/src/utils/azure/az-token';
import {
  getNativeAccount,
  initiateNativeLogin,
  nativeCredential,
  synchronizeNativeLogin,
} from '../../plugins/aks-desktop/src/utils/azure/native-auth';
import { queryPrometheus } from '../../plugins/aks-desktop/src/utils/prometheus/queryPrometheus';
import { createAzureAuthLiveStorage } from '../../plugins/aks-desktop/src/utils/test/azureAuthLiveTestUtils';

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler),
    removeHandler: (name: string) => handlers.delete(name),
  },
}));
vi.mock('../../plugins/aks-desktop/src/utils/shared/openExternalUrl', () => ({
  openExternalUrl: vi.fn(),
}));

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a native Prometheus 401 refreshes the main-process token without touching other tenants or ARM', async () => {
  vi.useFakeTimers();
  const tenant = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const otherTenant = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
  const subscription = '11111111-2222-3333-4444-555555555555';
  const scope = 'https://prometheus.monitor.azure.com/.default';
  const capability = 'a'.repeat(64);
  const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const webContents = Object.assign(new EventEmitter(), {
    mainFrame: { url: 'http://localhost:4466/' },
  });
  const mainWindow = { webContents, isDestroyed: () => false };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  const invoke = (channel: string, extra: Record<string, unknown> = {}) =>
    handlers.get(channel)!(event, { capability, sessionId, ...extra });
  cleanup = setupAzureOAuth({
    mainWindow: mainWindow as Parameters<typeof setupAzureOAuth>[0]['mainWindow'],
    trustedStartUrl: webContents.mainFrame.url,
    config: {
      clientId: 'offline-client',
      clouds: [
        {
          name: 'AzureCloud',
          authority: 'https://login.microsoftonline.com',
          scopes: ['https://management.core.windows.net//.default', scope],
        },
      ],
    },
    authorizeAzureOAuth: (_event, value) => value === capability,
    isAzureOAuthCapabilityLive: value => value === capability,
  });
  vi.stubGlobal('localStorage', createAzureAuthLiveStorage());
  const cli = vi.fn(() => {
    throw new Error('Native metrics must not use CLI');
  });
  vi.stubGlobal('pluginRunCommand', cli);
  vi.stubGlobal('pluginAzureOAuth', {
    startAzureLogin: (cloud: string, scope: string) => invoke(AZURE_OAUTH_START, { cloud, scope }),
    getAzureLoginStatus: () => invoke(AZURE_OAUTH_STATUS),
    getAzureToken: (scope: string, tenantId?: string, rejectedToken?: string) =>
      invoke(AZURE_OAUTH_TOKEN, { scope, tenantId, rejectedToken }),
  });
  let metricsRefreshes = 0;
  const bearers: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetch = vi.fn(async (value: string, init?: RequestInit) => {
    const url = new URL(value);
    if (url.pathname.endsWith('/devicecode'))
      return json({
        device_code: 'offline-code',
        user_code: 'CODE',
        verification_uri: 'https://microsoft.com/devicelogin',
        expires_in: 900,
        interval: 1,
      });
    if (url.pathname.endsWith('/token')) {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('scope') === scope) {
        const other = url.pathname.includes(otherTenant);
        if (!other) metricsRefreshes++;
        return json({
          access_token: other
            ? 'other-metrics'
            : metricsRefreshes === 1
            ? 'rejected-metrics'
            : 'fresh-metrics',
          expires_in: 3600,
        });
      }
      return json({
        access_token: 'arm-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        id_token: `header.${Buffer.from(
          JSON.stringify({
            tid: tenant,
            preferred_username: 'offline@example.test',
          })
        ).toString('base64url')}.signature`,
      });
    }
    if (url.pathname === '/tenants') return json({ value: [{ tenantId: tenant }] });
    if (url.pathname === '/subscriptions')
      return json({
        value: [
          {
            subscriptionId: subscription,
            displayName: 'offline',
            state: 'Enabled',
          },
        ],
      });
    if (url.hostname === 'prometheus.example') {
      const bearer = (init?.headers as Record<string, string>).Authorization;
      bearers.push(bearer);
      return bearer === 'Bearer rejected-metrics'
        ? json({}, 401)
        : json({
            status: 'success',
            data: { result: [{ metric: { pod: 'offline' } }] },
          });
    }
    throw new Error(`Unexpected offline HTTP route: ${url.origin}${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetch);
  await initiateNativeLogin(undefined, 'AzureCloud');
  await vi.advanceTimersByTimeAsync(1000);
  await synchronizeNativeLogin();
  expect(getNativeAccount()?.subscriptionId).toBe(subscription);
  const credential = getSubscriptionCredential(subscription);
  await credential.getToken(ARM_SCOPE);
  await nativeCredential.getToken(scope, { tenantId: otherTenant });
  const query = () => queryPrometheus('https://prometheus.example', 'up', 1, 2, 60, subscription);
  expect(await query()).toEqual([{ metric: { pod: 'offline' } }]);
  expect(metricsRefreshes).toBe(2);
  expect(bearers).toEqual(['Bearer rejected-metrics', 'Bearer fresh-metrics']);
  const calls = fetch.mock.calls.length;
  expect((await credential.getToken(ARM_SCOPE)).token).toBe('arm-token');
  expect((await nativeCredential.getToken(scope, { tenantId: otherTenant })).token).toBe(
    'other-metrics'
  );
  expect(fetch.mock.calls.length).toBe(calls);
  expect(await query()).toEqual([{ metric: { pod: 'offline' } }]);
  expect(metricsRefreshes).toBe(2);
  expect(cli).not.toHaveBeenCalled();
});
