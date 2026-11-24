// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { TokenCredential } from '@azure/identity';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execCommand: vi.fn(),
  hasNativeSession: vi.fn(),
  getNativeAccount: vi.fn(),
  getNativeAuthGeneration: vi.fn(),
  getNativeLoginError: vi.fn(),
  isAzureExplicitlySignedOut: vi.fn(),
  nativeGetToken: vi.fn(),
  updateNativeAccountTenant: vi.fn(),
}));

vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.execCommand }));
vi.mock('./az-cli-path', () => ({ getAzCommand: () => 'az' }));
vi.mock('./native-auth', () => ({
  hasNativeSession: mocks.hasNativeSession,
  getNativeAccount: mocks.getNativeAccount,
  getNativeAuthGeneration: mocks.getNativeAuthGeneration,
  getNativeLoginError: mocks.getNativeLoginError,
  isAzureExplicitlySignedOut: mocks.isAzureExplicitlySignedOut,
  nativeCredential: { getToken: mocks.nativeGetToken },
  updateNativeAccountTenant: mocks.updateNativeAccountTenant,
}));

import {
  ARM_SCOPE,
  AzTokenError,
  AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT,
  createAzCliCredential,
  getAzToken,
  getAzureAccountGeneration,
  getNativeSubscriptionTenant,
  getSubscriptionCredential,
  setNativeSubscriptionTenants,
} from './az-token';

const nowSeconds = () => Math.floor(Date.now() / 1000);

function cliToken(token: string, expiresInSeconds = 3600, tenant = 't') {
  return {
    stdout: JSON.stringify({
      accessToken: token,
      expires_on: nowSeconds() + expiresInSeconds,
      tenant,
      tokenType: 'Bearer',
    }),
    stderr: '',
  };
}

beforeEach(() => {
  mocks.execCommand.mockReset();
  mocks.hasNativeSession.mockReturnValue(false);
  mocks.getNativeAccount.mockReturnValue(undefined);
  mocks.getNativeAuthGeneration.mockReturnValue(0);
  mocks.getNativeLoginError.mockReturnValue(undefined);
  mocks.isAzureExplicitlySignedOut.mockReturnValue(false);
  mocks.nativeGetToken.mockReset();
  mocks.updateNativeAccountTenant.mockReset().mockReturnValue(true);
  window.dispatchEvent(new CustomEvent('azure-account-change'));
});

describe('subscription credentials', () => {
  test('a silent native reset invalidates bindings and pending tokens', async () => {
    const subscription = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const tenant = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    mocks.hasNativeSession.mockReturnValue(true);
    let release!: (value: { token: string; expiresOnTimestamp: number }) => void;
    mocks.nativeGetToken.mockReturnValue(new Promise(resolve => (release = resolve)));
    const generation = getAzureAccountGeneration();
    setNativeSubscriptionTenants([{ id: subscription, tenant }], generation);
    const pending = getSubscriptionCredential(subscription).getToken(ARM_SCOPE);
    mocks.getNativeAuthGeneration.mockReturnValue(1);
    release({ token: 'stale', expiresOnTimestamp: Date.now() + 3_600_000 });
    await expect(pending).rejects.toThrow('account changed');
    expect(setNativeSubscriptionTenants([{ id: subscription, tenant }], generation)).toBe(false);
    await expect(getSubscriptionCredential(subscription).getToken(ARM_SCOPE)).rejects.toThrow(
      'No tenant is known'
    );
  });

  test('explicit sign-out blocks CLI fallback and invalidates pending CLI tokens', async () => {
    let release!: (value: ReturnType<typeof cliToken>) => void;
    mocks.execCommand.mockReturnValue(new Promise(resolve => (release = resolve)));
    const pending = getAzToken();
    mocks.isAzureExplicitlySignedOut.mockReturnValue(true);
    await expect(
      getSubscriptionCredential('bbbbbbbb-cccc-dddd-eeee-ffffffffffff').getToken(ARM_SCOPE)
    ).rejects.toMatchObject({ message: 'Azure login is required', needsRelogin: true });
    await expect(getAzToken()).rejects.toMatchObject({ needsRelogin: true });
    release(cliToken('stale'));
    await expect(pending).rejects.toThrow('account changed');
    expect(mocks.execCommand).toHaveBeenCalledTimes(1);
    mocks.isAzureExplicitlySignedOut.mockReturnValue(false);
    window.dispatchEvent(new CustomEvent('azure-account-change'));
    mocks.execCommand.mockResolvedValue(cliToken('after-sign-in'));
    expect((await getAzToken()).token).toBe('after-sign-in');
  });

  test('uses the discovered tenant for native bound tokens and rejects unknown or mismatched subscriptions', async () => {
    const subscription = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const tenant = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    mocks.hasNativeSession.mockReturnValue(true);
    mocks.nativeGetToken.mockResolvedValue({
      token: 'native',
      expiresOnTimestamp: Date.now() + 3_600_000,
    });
    const bound = getSubscriptionCredential(subscription.toUpperCase());
    await expect(bound.getToken(ARM_SCOPE)).rejects.toThrow('No tenant is known');
    expect(
      setNativeSubscriptionTenants([{ id: subscription, tenant }], getAzureAccountGeneration())
    ).toBe(true);
    await expect(bound.getToken(ARM_SCOPE)).resolves.toMatchObject({ token: 'native' });
    expect(getNativeSubscriptionTenant(subscription.toUpperCase())).toBe(tenant);
    expect(mocks.nativeGetToken).toHaveBeenCalledWith(ARM_SCOPE, { tenantId: tenant });
    await expect(
      bound.getToken(ARM_SCOPE, { tenantId: '11111111-1111-1111-1111-111111111111' })
    ).rejects.toThrow('requested tenant');
    expect(mocks.execCommand).not.toHaveBeenCalled();
  });

  test('invalidates native mappings and tokens when discovery or the account changes', async () => {
    const subscription = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const tenantA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const tenantB = '11111111-1111-1111-1111-111111111111';
    mocks.hasNativeSession.mockReturnValue(true);
    mocks.nativeGetToken.mockImplementation(async (_scope, options) => ({
      token: options.tenantId,
      expiresOnTimestamp: Date.now() + 3_600_000,
    }));
    const credential = getSubscriptionCredential(subscription);
    const generation = getAzureAccountGeneration();
    setNativeSubscriptionTenants([{ id: subscription, tenant: tenantA }], generation);
    expect((await credential.getToken(ARM_SCOPE)).token).toBe(tenantA);
    setNativeSubscriptionTenants([{ id: subscription, tenant: tenantB }], generation);
    expect((await credential.getToken(ARM_SCOPE)).token).toBe(tenantB);
    window.dispatchEvent(new CustomEvent('azure-account-change'));
    expect(setNativeSubscriptionTenants([{ id: subscription, tenant: tenantA }], generation)).toBe(
      false
    );
    await expect(credential.getToken(ARM_SCOPE)).rejects.toThrow('No tenant is known');
  });

  test('notifies consumers when an effective subscription tenant is added or changes', () => {
    const subscription = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const tenantA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const tenantB = '11111111-1111-1111-1111-111111111111';
    mocks.hasNativeSession.mockReturnValue(true);
    const listener = vi.fn();
    window.addEventListener(AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT, listener);
    const generation = getAzureAccountGeneration();

    setNativeSubscriptionTenants([{ id: subscription, tenant: tenantA }], generation);
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      subscriptionIds: [subscription],
    });
    listener.mockClear();
    setNativeSubscriptionTenants([{ id: subscription, tenant: tenantB }], generation);

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      subscriptionIds: [subscription],
    });
    window.removeEventListener(AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT, listener);
  });

  test('seeds the selected native account on account events', async () => {
    const subscription = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const tenant = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    mocks.hasNativeSession.mockReturnValue(true);
    mocks.getNativeAccount.mockReturnValue({ subscriptionId: subscription, tenantId: tenant });
    mocks.nativeGetToken.mockResolvedValue({
      token: 'selected',
      expiresOnTimestamp: Date.now() + 3_600_000,
    });
    window.dispatchEvent(new CustomEvent('azure-account-change'));
    await getSubscriptionCredential(subscription).getToken(ARM_SCOPE);
    expect(mocks.nativeGetToken).toHaveBeenCalledWith(ARM_SCOPE, { tenantId: tenant });
  });

  test('preserves initial discovered bindings on native account publication and repeated events', async () => {
    const subscription = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const other = 'cccccccc-dddd-eeee-ffff-000000000001';
    const tenant = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const otherTenant = '11111111-1111-1111-1111-111111111111';
    mocks.hasNativeSession.mockReturnValue(true);
    mocks.nativeGetToken.mockImplementation(async (_scope, options) => ({
      token: options.tenantId,
      expiresOnTimestamp: Date.now() + 3_600_000,
    }));
    setNativeSubscriptionTenants(
      [
        { id: subscription, tenant },
        { id: other, tenant: otherTenant },
      ],
      getAzureAccountGeneration()
    );
    mocks.getNativeAccount.mockReturnValue({ subscriptionId: subscription, tenantId: tenant });
    window.dispatchEvent(new CustomEvent('azure-account-change'));
    window.dispatchEvent(new CustomEvent('azure-auth-update'));
    expect((await getSubscriptionCredential(other).getToken(ARM_SCOPE)).token).toBe(otherTenant);
    mocks.getNativeAuthGeneration.mockReturnValue(1);
    window.dispatchEvent(new CustomEvent('azure-account-change'));
    await expect(getSubscriptionCredential(other).getToken(ARM_SCOPE)).rejects.toThrow(
      'No tenant is known'
    );
  });

  test('preserves only bindings owned by tenants whose discovery failed', () => {
    const tenantA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const tenantB = '11111111-1111-1111-1111-111111111111';
    mocks.hasNativeSession.mockReturnValue(true);
    const staleA = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const currentA = 'cccccccc-dddd-eeee-ffff-000000000001';
    const preservedB = 'dddddddd-eeee-ffff-0000-000000000002';
    const generation = getAzureAccountGeneration();
    setNativeSubscriptionTenants(
      [
        { id: staleA, tenant: tenantA },
        { id: preservedB, tenant: tenantB },
      ],
      generation
    );

    setNativeSubscriptionTenants([{ id: currentA, tenant: tenantA }], generation, [tenantB]);

    expect(getNativeSubscriptionTenant(staleA)).toBeUndefined();
    expect(getNativeSubscriptionTenant(currentA)).toBe(tenantA);
    expect(getNativeSubscriptionTenant(preservedB)).toBe(tenantB);
  });

  test('retains duplicate subscription tenants during partial discovery', () => {
    const subscription = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const tenantA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const tenantB = '11111111-1111-1111-1111-111111111111';
    mocks.hasNativeSession.mockReturnValue(true);
    const generation = getAzureAccountGeneration();
    setNativeSubscriptionTenants(
      [
        { id: subscription, tenant: tenantA },
        { id: subscription, tenant: tenantB },
      ],
      generation
    );

    expect(getNativeSubscriptionTenant(subscription)).toBe(tenantA);
    setNativeSubscriptionTenants([{ id: subscription, tenant: tenantB }], generation, [tenantA]);
    expect(getNativeSubscriptionTenant(subscription)).toBe(tenantA);
    setNativeSubscriptionTenants([{ id: subscription, tenant: tenantB }], generation);
    expect(getNativeSubscriptionTenant(subscription)).toBe(tenantB);
  });

  test('keeps the selected native account tenant aligned with the effective binding', () => {
    const subscription = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const tenantA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const tenantB = '11111111-1111-1111-1111-111111111111';
    mocks.hasNativeSession.mockReturnValue(true);
    mocks.getNativeAccount.mockReturnValue({
      subscriptionId: subscription,
      tenantId: tenantA,
    });

    expect(
      setNativeSubscriptionTenants(
        [{ id: subscription, tenant: tenantA, tenants: [tenantA, tenantB] }],
        getAzureAccountGeneration()
      )
    ).toBe(true);

    expect(mocks.updateNativeAccountTenant).toHaveBeenCalledWith(subscription, tenantA);
  });

  test('preserves failed duplicate tenant alternatives during partial discovery', () => {
    const subscription = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const tenantA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const tenantB = '11111111-1111-1111-1111-111111111111';
    mocks.hasNativeSession.mockReturnValue(true);
    const generation = getAzureAccountGeneration();
    setNativeSubscriptionTenants(
      [
        { id: subscription, tenant: tenantA },
        { id: subscription, tenant: tenantB },
      ],
      generation
    );

    setNativeSubscriptionTenants([{ id: subscription, tenant: tenantA }], generation, [tenantB]);

    setNativeSubscriptionTenants([{ id: subscription, tenant: tenantB }], generation, [tenantA]);
    expect(getNativeSubscriptionTenant(subscription)).toBe(tenantA);
  });

  test('does not return an in-flight token after a native mapping or account change', async () => {
    const subscription = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const tenant = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    mocks.hasNativeSession.mockReturnValue(true);
    let release!: (token: { token: string; expiresOnTimestamp: number }) => void;
    mocks.nativeGetToken.mockReturnValue(new Promise(resolve => (release = resolve)));
    setNativeSubscriptionTenants([{ id: subscription, tenant }], getAzureAccountGeneration());
    const pending = getSubscriptionCredential(subscription).getToken(ARM_SCOPE);
    window.dispatchEvent(new CustomEvent('azure-account-change'));
    release({ token: 'stale', expiresOnTimestamp: Date.now() + 3_600_000 });
    await expect(pending).rejects.toThrow('account changed');
  });

  test('keeps in-flight tokens valid when an unrelated subscription binding changes', async () => {
    const subscriptionA = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const subscriptionB = 'cccccccc-dddd-eeee-ffff-000000000001';
    const tenantA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const tenantB = '11111111-1111-1111-1111-111111111111';
    const tenantC = '22222222-2222-2222-2222-222222222222';
    mocks.hasNativeSession.mockReturnValue(true);
    const releases: Array<(token: { token: string; expiresOnTimestamp: number }) => void> = [];
    mocks.nativeGetToken.mockImplementation(() => new Promise(resolve => releases.push(resolve)));
    const generation = getAzureAccountGeneration();
    setNativeSubscriptionTenants(
      [
        { id: subscriptionA, tenant: tenantA },
        { id: subscriptionB, tenant: tenantB },
      ],
      generation
    );
    const bound = getSubscriptionCredential(subscriptionA).getToken(ARM_SCOPE);
    const explicitlyScoped = createAzCliCredential().getToken(ARM_SCOPE, {
      tenantId: tenantA,
    });

    setNativeSubscriptionTenants(
      [
        { id: subscriptionA, tenant: tenantA },
        { id: subscriptionB, tenant: tenantC },
      ],
      generation
    );
    releases[0]({ token: 'bound', expiresOnTimestamp: Date.now() + 3_600_000 });
    releases[1]({ token: 'explicit', expiresOnTimestamp: Date.now() + 3_600_000 });

    await expect(bound).resolves.toMatchObject({ token: 'bound' });
    await expect(explicitlyScoped).resolves.toMatchObject({ token: 'explicit' });
  });

  test('never reuses a CLI token after switching to native authentication', async () => {
    const subscription = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const tenant = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const credential = getSubscriptionCredential(subscription);
    mocks.execCommand.mockResolvedValue(cliToken('cli'));
    expect((await credential.getToken(ARM_SCOPE)).token).toBe('cli');
    mocks.hasNativeSession.mockReturnValue(true);
    mocks.nativeGetToken.mockResolvedValue({
      token: 'native',
      expiresOnTimestamp: Date.now() + 3_600_000,
    });
    setNativeSubscriptionTenants([{ id: subscription, tenant }], getAzureAccountGeneration());
    expect((await credential.getToken(ARM_SCOPE)).token).toBe('native');
  });

  test('external account changes invalidate default and subscription token caches', async () => {
    const bound = getSubscriptionCredential('11111111-2222-3333-4444-555555555555');
    bound.clearCache();
    mocks.execCommand.mockResolvedValue(cliToken('before-switch'));
    await getAzToken();
    await bound.getToken(ARM_SCOPE);
    await getAzToken();
    await bound.getToken(ARM_SCOPE);
    expect(mocks.execCommand).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new CustomEvent('azure-account-change'));
    mocks.execCommand.mockResolvedValue(cliToken('after-switch'));
    expect((await getAzToken()).token).toBe('after-switch');
    expect((await bound.getToken(ARM_SCOPE)).token).toBe('after-switch');
    expect(mocks.execCommand).toHaveBeenCalledTimes(4);
  });

  test('keeps the selected subscription account and validates an explicit tenant without combining selectors', async () => {
    const subscriptionId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const tenantId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const credential = getSubscriptionCredential(subscriptionId);
    credential.clearCache();
    mocks.execCommand.mockResolvedValue(cliToken('tenant-token', 3600, tenantId));
    await credential.getToken(ARM_SCOPE, { tenantId });
    expect(mocks.execCommand).toHaveBeenCalledWith('az', [
      'account',
      'get-access-token',
      '--scope',
      ARM_SCOPE,
      '-o',
      'json',
      '--subscription',
      subscriptionId,
    ]);
    await credential.getToken(ARM_SCOPE, { tenantId });
    expect(mocks.execCommand).toHaveBeenCalledTimes(1);
    await credential.getToken(ARM_SCOPE);
    expect(mocks.execCommand).toHaveBeenLastCalledWith(
      'az',
      expect.arrayContaining(['--subscription', subscriptionId])
    );
    expect(mocks.execCommand).toHaveBeenCalledTimes(2);
  });

  test('separates cached accounts in the same tenant using the selected subscription', async () => {
    const tenantId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const first = getSubscriptionCredential('11111111-2222-3333-4444-555555555555');
    const second = getSubscriptionCredential('bbbbbbbb-cccc-dddd-eeee-ffffffffffff');
    first.clearCache();
    second.clearCache();
    mocks.execCommand.mockImplementation(async (_command: string, args: string[]) =>
      cliToken(`account-${args[args.indexOf('--subscription') + 1]}`, 3600, tenantId)
    );
    const firstToken = await first.getToken(ARM_SCOPE, { tenantId });
    const secondToken = await second.getToken(ARM_SCOPE, { tenantId });
    expect(firstToken.token).not.toBe(secondToken.token);
    expect(await first.getToken(ARM_SCOPE, { tenantId })).toBe(firstToken);
    expect(await second.getToken(ARM_SCOPE, { tenantId })).toBe(secondToken);
    expect(mocks.execCommand).toHaveBeenCalledTimes(2);
    expect(mocks.execCommand.mock.calls.every(([, args]) => !args.includes('--tenant'))).toBe(true);
  });

  test.each(['wrong-tenant', undefined])(
    'rejects a token with unverified tenant %s and permits retry',
    async returnedTenant => {
      const credential = getSubscriptionCredential('cccccccc-dddd-eeee-ffff-000000000001');
      const tenantId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      credential.clearCache();
      mocks.execCommand
        .mockResolvedValueOnce(cliToken('wrong', 3600, returnedTenant ?? ''))
        .mockResolvedValueOnce(cliToken('correct', 3600, tenantId));
      await expect(credential.getToken(ARM_SCOPE, { tenantId })).rejects.toThrow(
        'requested tenant'
      );
      expect(await credential.getToken(ARM_SCOPE, { tenantId })).toMatchObject({
        token: 'correct',
      });
      expect(mocks.execCommand).toHaveBeenCalledTimes(2);
    }
  );

  test('fails explicitly when a bound tenant cannot be validated as a GUID', async () => {
    const credential = getSubscriptionCredential('cccccccc-dddd-eeee-ffff-000000000002');
    await expect(credential.getToken(ARM_SCOPE, { tenantId: 'contoso.com' })).rejects.toThrow(
      'tenant GUID'
    );
    expect(mocks.execCommand).not.toHaveBeenCalled();
  });

  test('selects and caches authentication per subscription, and clears on account changes', async () => {
    const first = '11111111-2222-3333-4444-555555555555';
    const second = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    mocks.execCommand.mockResolvedValue(cliToken('selected-token'));
    const credential = getSubscriptionCredential(first);
    await credential.getToken(ARM_SCOPE);
    await getSubscriptionCredential(first).getToken(ARM_SCOPE);
    expect(mocks.execCommand).toHaveBeenCalledTimes(1);
    expect(mocks.execCommand).toHaveBeenLastCalledWith(
      'az',
      expect.arrayContaining(['--subscription', first])
    );
    await getSubscriptionCredential(second).getToken(ARM_SCOPE);
    expect(mocks.execCommand).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new CustomEvent('azure-auth-update'));
    await credential.getToken(ARM_SCOPE);
    expect(mocks.execCommand).toHaveBeenCalledTimes(3);
    expect(() => getSubscriptionCredential('invalid')).toThrow('Invalid subscription');
  });
});

describe('createAzCliCredential', () => {
  test('uses native tokens without invoking Azure CLI when a native session exists', async () => {
    mocks.hasNativeSession.mockReturnValue(true);
    mocks.nativeGetToken.mockResolvedValue({
      token: 'native-token',
      expiresOnTimestamp: Date.now() + 3_600_000,
    });

    await expect(
      createAzCliCredential().getToken(ARM_SCOPE, { tenantId: 'native-tenant' })
    ).resolves.toMatchObject({ token: 'native-token' });
    expect(mocks.nativeGetToken).toHaveBeenCalledWith(ARM_SCOPE, {
      tenantId: 'native-tenant',
    });
    expect(mocks.execCommand).not.toHaveBeenCalled();
  });

  test('satisfies the Azure SDK TokenCredential contract', () => {
    const credential: TokenCredential = createAzCliCredential();
    expect(typeof credential.getToken).toBe('function');
  });

  test('requests the scope and tenant explicitly and maps the token', async () => {
    mocks.execCommand.mockResolvedValue(cliToken('tok-1'));
    const token = await createAzCliCredential().getToken(ARM_SCOPE, { tenantId: 'contoso.com' });

    expect(token.token).toBe('tok-1');
    expect(token.expiresOnTimestamp).toBeGreaterThan(Date.now());
    expect(mocks.execCommand).toHaveBeenCalledWith('az', [
      'account',
      'get-access-token',
      '--scope',
      ARM_SCOPE,
      '-o',
      'json',
      '--tenant',
      'contoso.com',
    ]);
  });

  test('caches per tenant and scope', async () => {
    mocks.execCommand.mockImplementation(async (_cmd: string, args: string[]) =>
      cliToken(`tok-${args.join(' ')}`)
    );
    const credential = createAzCliCredential();

    const a = await credential.getToken(ARM_SCOPE);
    const b = await credential.getToken([ARM_SCOPE]);
    const c = await credential.getToken(ARM_SCOPE, { tenantId: 'other' });
    const d = await credential.getToken('https://graph.microsoft.com/.default');

    expect(a).toBe(b);
    expect(c.token).not.toBe(a.token);
    expect(d.token).not.toBe(a.token);
    expect(mocks.execCommand).toHaveBeenCalledTimes(3);
  });

  test('shares one CLI call between concurrent requests', async () => {
    let release!: (value: unknown) => void;
    mocks.execCommand.mockReturnValue(new Promise(resolve => (release = resolve)));
    const credential = createAzCliCredential();

    const pending = Promise.all([credential.getToken(ARM_SCOPE), credential.getToken(ARM_SCOPE)]);
    release(cliToken('shared'));

    const [a, b] = await pending;
    expect(a.token).toBe('shared');
    expect(b.token).toBe('shared');
    expect(mocks.execCommand).toHaveBeenCalledTimes(1);
  });

  test('refreshes tokens that are close to expiry', async () => {
    mocks.execCommand
      .mockResolvedValueOnce(cliToken('old', 60))
      .mockResolvedValueOnce(cliToken('new'));
    const credential = createAzCliCredential();

    expect((await credential.getToken(ARM_SCOPE)).token).toBe('old');
    expect((await credential.getToken(ARM_SCOPE)).token).toBe('new');
    expect(mocks.execCommand).toHaveBeenCalledTimes(2);
  });

  test('does not cache failures', async () => {
    mocks.execCommand
      .mockResolvedValueOnce({ stdout: '', stderr: 'ERROR: network down' })
      .mockResolvedValueOnce(cliToken('recovered'));
    const credential = createAzCliCredential();

    await expect(credential.getToken(ARM_SCOPE)).rejects.toThrow('network down');
    expect((await credential.getToken(ARM_SCOPE)).token).toBe('recovered');
  });

  test('flags errors that need re-login', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: '', stderr: "ERROR: Please run 'az login'" });

    const error: any = await createAzCliCredential()
      .getToken(ARM_SCOPE)
      .catch(e => e);
    expect(error).toBeInstanceOf(AzTokenError);
    expect(error.needsRelogin).toBe(true);
  });

  test('never echoes CLI stdout in parse errors', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: '{"accessToken":"secret-tok', stderr: '' });

    const error: any = await createAzCliCredential()
      .getToken(ARM_SCOPE)
      .catch(e => e);
    expect(error.message).toMatch(/malformed/);
    expect(error.message).not.toContain('secret-tok');
  });

  test('rejects responses without an expiry', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: '{"accessToken":"tok"}', stderr: '' });
    await expect(createAzCliCredential().getToken(ARM_SCOPE)).rejects.toThrow(/missing/);
  });

  test.each([['--subscription'], ['a b'], ['']])('rejects unsafe tenant %j', async tenantId => {
    await expect(createAzCliCredential().getToken(ARM_SCOPE, { tenantId })).rejects.toThrow(
      /Invalid tenant/
    );
    expect(mocks.execCommand).not.toHaveBeenCalled();
  });

  test.each([[[]], [['--help']], [[ARM_SCOPE, ARM_SCOPE]]])(
    'rejects invalid scopes %j',
    async scopes => {
      await expect(createAzCliCredential().getToken(scopes)).rejects.toThrow(/scope/);
      expect(mocks.execCommand).not.toHaveBeenCalled();
    }
  );

  test('honors abort signals while the CLI call continues for other callers', async () => {
    mocks.execCommand.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();

    const pending = createAzCliCredential().getToken(ARM_SCOPE, {
      abortSignal: controller.signal,
    });
    controller.abort(new Error('cancelled'));

    await expect(pending).rejects.toThrow('cancelled');
  });

  test('does not run az when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(
      createAzCliCredential().getToken(ARM_SCOPE, { abortSignal: controller.signal })
    ).rejects.toThrow('cancelled');
    expect(mocks.execCommand).not.toHaveBeenCalled();
  });

  test('scope eviction rejects pending metrics tokens without invalidating pending ARM tokens', async () => {
    const scope = 'https://prometheus.monitor.azure.com/.default';
    let releaseArm!: (value: ReturnType<typeof cliToken>) => void;
    let releaseMetrics!: (value: ReturnType<typeof cliToken>) => void;
    mocks.execCommand
      .mockReturnValueOnce(new Promise(resolve => (releaseArm = resolve)))
      .mockReturnValueOnce(new Promise(resolve => (releaseMetrics = resolve)));
    const credential = createAzCliCredential();
    const arm = credential.getToken(ARM_SCOPE);
    const metrics = credential.getToken(scope);
    const rejected = expect(metrics).rejects.toThrow('account changed');
    credential.clearCache(scope);
    releaseArm(cliToken('arm-valid'));
    releaseMetrics(cliToken('metrics-stale'));
    await expect(arm).resolves.toMatchObject({ token: 'arm-valid' });
    await rejected;
    mocks.execCommand.mockResolvedValue(cliToken('metrics-fresh'));
    await expect(credential.getToken(scope)).resolves.toMatchObject({ token: 'metrics-fresh' });
    await expect(credential.getToken(ARM_SCOPE)).resolves.toMatchObject({ token: 'arm-valid' });
    expect(mocks.execCommand).toHaveBeenCalledTimes(3);
  });

  test('clearCache(scope) evicts only matching scope across tenants while keeping other scopes cached', async () => {
    const PROM_SCOPE = 'https://prometheus.monitor.azure.com/.default';
    mocks.execCommand
      .mockResolvedValueOnce(cliToken('arm-1'))
      .mockResolvedValueOnce(cliToken('prom-a-1'))
      .mockResolvedValueOnce(cliToken('prom-b-1'))
      .mockResolvedValueOnce(cliToken('prom-a-2'))
      .mockResolvedValueOnce(cliToken('prom-b-2'));
    const credential = createAzCliCredential();

    expect((await credential.getToken(ARM_SCOPE)).token).toBe('arm-1');
    expect((await credential.getToken(PROM_SCOPE, { tenantId: 'tenant-a' })).token).toBe(
      'prom-a-1'
    );
    expect((await credential.getToken(PROM_SCOPE, { tenantId: 'tenant-b' })).token).toBe(
      'prom-b-1'
    );
    expect(mocks.execCommand).toHaveBeenCalledTimes(3);

    credential.clearCache(PROM_SCOPE);

    expect((await credential.getToken(ARM_SCOPE)).token).toBe('arm-1');
    expect((await credential.getToken(PROM_SCOPE, { tenantId: 'tenant-a' })).token).toBe(
      'prom-a-2'
    );
    expect((await credential.getToken(PROM_SCOPE, { tenantId: 'tenant-b' })).token).toBe(
      'prom-b-2'
    );
    expect(mocks.execCommand).toHaveBeenCalledTimes(5);
  });
});

describe('shared credential', () => {
  test('getAzToken defaults to the ARM scope', async () => {
    mocks.execCommand.mockResolvedValue(cliToken('arm'));
    expect((await getAzToken()).token).toBe('arm');
    expect(mocks.execCommand.mock.calls[0][1]).toContain(ARM_SCOPE);
  });

  test('clears its cache on azure-auth-update (login, logout, account switch)', async () => {
    mocks.execCommand
      .mockResolvedValueOnce(cliToken('before'))
      .mockResolvedValueOnce(cliToken('after'));

    expect((await getAzToken()).token).toBe('before');
    window.dispatchEvent(new CustomEvent('azure-auth-update'));
    expect((await getAzToken()).token).toBe('after');
  });
});
