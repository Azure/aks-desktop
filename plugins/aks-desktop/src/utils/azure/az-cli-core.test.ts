// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execCommand: vi.fn(),
  getAzCommand: vi.fn(() => '/bundled/az'),
  native: vi.fn<
    () =>
      | { username?: string; tenantId: string; subscriptionId: string; environmentName: string }
      | undefined
  >(() => undefined),
  generation: vi.fn(() => 0),
  nativeSession: vi.fn(() => false),
  nativeError: vi.fn<() => string | undefined>(() => undefined),
  signedOut: vi.fn(() => false),
  updateNativeAccountTenant: vi.fn(() => true),
}));

vi.mock('../shared/runCommandAsync', () => ({
  runCommandAsync: mocks.execCommand,
}));

vi.mock('./az-cli-path', () => ({
  getAzCommand: mocks.getAzCommand,
}));

vi.mock('./native-auth', () => ({
  getNativeAccount: mocks.native,
  getNativeAuthGeneration: mocks.generation,
  getNativeLoginError: mocks.nativeError,
  hasNativeSession: mocks.nativeSession,
  isAzureExplicitlySignedOut: mocks.signedOut,
  updateNativeAccountTenant: mocks.updateNativeAccountTenant,
}));

import {
  allowCliOperations,
  blockCliOperations,
  getErrorMessage,
  isAzCliInstalled,
  isAzCliLoggedIn,
  isAzError,
  isCliNotFoundError,
  isValidGuid,
  needsRelogin,
  registerNativeSubscriptionTenantLookup,
  runAzCommand,
  runCommandAsync,
  withVerifiedCliBatch,
  withVerifiedCliCapabilityAccess,
} from './az-cli-core';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAzCommand.mockReturnValue('/bundled/az');
  mocks.generation.mockReturnValue(0);
  mocks.nativeSession.mockReturnValue(false);
  mocks.signedOut.mockReturnValue(false);
  allowCliOperations();
  registerNativeSubscriptionTenantLookup(id => (id.toLowerCase() === 'sub' ? 'tenant' : undefined));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  mocks.native.mockReturnValue(undefined);
  mocks.execCommand.mockImplementation((_command: string, args: string[]) =>
    Promise.resolve({
      stdout: args[0] === 'login' ? '[{}]' : '{"id":"sub","tenantId":"tenant"}',
      stderr: '',
    })
  );
  await runCommandAsync('az', ['login', '--output', 'json']);
});

describe('withVerifiedCliBatch', () => {
  const subscriptionId = '11111111-2222-3333-4444-555555555555';
  const identityError = expect.stringContaining('identity could not be verified');

  test('rejects invalid subscription identifiers before invoking the callback', async () => {
    const operation = vi.fn();

    await expect(withVerifiedCliBatch('not-a-guid', operation)).rejects.toThrow(
      'identity could not be verified'
    );
    expect(operation).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', ['group', 'list', '--output', 'json']],
    ['mismatched', ['group', 'list', '--subscription', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']],
    ['identity-changing', ['account', 'set', '--subscription', subscriptionId]],
  ])('blocks %s command selectors inside a verified batch', async (_label, args) => {
    mocks.execCommand.mockResolvedValue({ stdout: 'should-not-run', stderr: '' });

    const result = await withVerifiedCliBatch(subscriptionId, run => run(args));

    expect(result).toEqual({ stdout: '', stderr: identityError });
    expect(mocks.execCommand).not.toHaveBeenCalled();
  });

  test('blocks commands after the native generation changes', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: 'should-not-run', stderr: '' });

    const result = await withVerifiedCliBatch(subscriptionId, run => {
      mocks.generation.mockReturnValue(1);
      return run(['group', 'list', '--subscription', subscriptionId]);
    });

    expect(result).toEqual({ stdout: '', stderr: identityError });
    expect(mocks.execCommand).not.toHaveBeenCalled();
  });

  test('releases its reader lease when the callback rejects', async () => {
    await expect(
      withVerifiedCliBatch(subscriptionId, async () => {
        throw new Error('operation failed');
      })
    ).rejects.toThrow('operation failed');
    mocks.execCommand.mockResolvedValue({ stdout: '', stderr: '' });

    await expect(
      runCommandAsync('az', ['account', 'set', '--subscription', subscriptionId])
    ).resolves.toEqual({ stdout: '', stderr: '' });
    expect(mocks.execCommand).toHaveBeenCalledWith('/bundled/az', [
      'account',
      'set',
      '--subscription',
      subscriptionId,
    ]);
  });
});

describe('Azure CLI availability for optional sign-in', () => {
  test.each([
    [{ stdout: '{"azure-cli":"2.90.0"}', stderr: '' }, true],
    [{ stdout: '', stderr: 'az: command not found' }, false],
  ])('reports availability for %o', async (result, expected) => {
    mocks.execCommand.mockResolvedValue(result);

    await expect(isAzCliInstalled()).resolves.toBe(expected);
    expect(mocks.execCommand).toHaveBeenCalledWith('/bundled/az', ['version']);
  });
});

describe('needsRelogin', () => {
  test.each([
    'Interactive authentication is needed. Please run: az login',
    'AADSTS700082: The refresh token has expired.',
    'AADSTS50173: The provided grant has expired.',
    'Please run "az login" to setup account.',
    'ERROR: Please run az login',
  ])('recognizes Azure CLI login guidance: %s', error => {
    expect(needsRelogin(error)).toBe(true);
  });

  test('does not classify unrelated command failures as relogin guidance', () => {
    expect(needsRelogin('Command execution error: bridge disconnected')).toBe(false);
  });
});

describe('command helpers', () => {
  test('resolves Azure CLI commands through the bundled path', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: 'ok', stderr: '' });

    await expect(runCommandAsync('az', ['account', 'show'])).resolves.toEqual({
      stdout: 'ok',
      stderr: '',
    });
    expect(mocks.execCommand).toHaveBeenCalledWith('/bundled/az', ['account', 'show']);
  });

  test('passes non-Azure commands through unchanged', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: 'ok', stderr: '' });

    await runCommandAsync('kubectl', ['version']);

    expect(mocks.execCommand).toHaveBeenCalledWith('kubectl', ['version']);
  });

  test('validates GUIDs', () => {
    expect(isValidGuid('12345678-1234-1234-1234-123456789abc')).toBe(true);
    expect(isValidGuid('not-a-guid')).toBe(false);
  });

  test('classifies Azure and missing-command errors', () => {
    expect(isAzError('ERROR: command failed')).toBe(true);
    expect(isAzError('WARNING: retrying')).toBe(false);
    expect(isCliNotFoundError('az: command not found')).toBe(true);
    expect(isCliNotFoundError('Command execution error: spawn az ENOENT')).toBe(true);
    expect(
      isCliNotFoundError("'az.cmd' is not recognized as an internal or external command")
    ).toBe(true);
    expect(isCliNotFoundError('Azure CLI (az) command not found')).toBe(true);
    expect(isCliNotFoundError("ERROR: Resource group 'missing' was not found.")).toBe(false);
    expect(isCliNotFoundError('bridge disconnected')).toBe(false);
  });

  test('normalizes thrown error messages', () => {
    expect(getErrorMessage(new Error('failed'))).toBe('failed');
    expect(getErrorMessage('private value')).toBe('Unknown error');
  });
});

describe('Azure CLI status', () => {
  test('reports a usable logged-in account', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: 'user@example.com\n', stderr: '' });

    await expect(isAzCliLoggedIn()).resolves.toBe(true);
  });

  test.each([
    'az: command not found',
    'Please run "az login" to setup account.',
    'No active account',
  ])('reports logged out for stderr: %s', async stderr => {
    mocks.execCommand.mockResolvedValue({ stdout: '', stderr });

    await expect(isAzCliLoggedIn()).resolves.toBe(false);
  });

  test('reports logged out when the bridge rejects', async () => {
    mocks.execCommand.mockRejectedValue(new Error('bridge failed'));

    await expect(isAzCliLoggedIn()).resolves.toBe(false);
  });
});

describe('runAzCommand', () => {
  test('returns parsed command output', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: '{"value":42}', stderr: '' });

    await expect(
      runAzCommand(['mock'], 'Running:', 'run mock', stdout => JSON.parse(stdout).value)
    ).resolves.toEqual({ success: true, data: 42 });
  });

  describe('Azure CLI identity guard', () => {
    const native = {
      username: 'User@example.com',
      tenantId: 'tenant',
      subscriptionId: 'sub',
      environmentName: 'AzureCloud',
    };
    const account = {
      id: 'sub',
      user: { name: 'user@example.com' },
      tenantId: 'TENANT',
      cloudName: 'azurecloud',
    };
    const commandResult = { stdout: 'result', stderr: '' };
    const denied = { stdout: '', stderr: expect.stringContaining('ERROR: Azure CLI identity') };

    function acceptNative() {
      mocks.native.mockReturnValue(native);
      allowCliOperations();
    }

    function mockCli(currentAccount: unknown = account, cloud: unknown = { name: 'AzureCloud' }) {
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'account' && args[1] === 'show') {
          return Promise.resolve({ stdout: JSON.stringify(currentAccount), stderr: '' });
        }
        if (args[0] === 'cloud' && args[1] === 'show') {
          return Promise.resolve({ stdout: JSON.stringify(cloud), stderr: '' });
        }
        return Promise.resolve(commandResult);
      });
    }

    function deferred<T>() {
      let resolve!: (value: T) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    test('allows matching identities and checks the requested subscription', async () => {
      acceptNative();
      mockCli();
      await expect(
        runCommandAsync('az', ['group', 'list', '--subscription', 'sub'])
      ).resolves.toEqual(commandResult);
      expect(mocks.execCommand).toHaveBeenCalledWith('/bundled/az', [
        'account',
        'show',
        '--subscription',
        'sub',
        '-o',
        'json',
      ]);
    });

    test('holds the reader lease until a verified capability completes', async () => {
      const subscriptionId = '11111111-2222-3333-4444-555555555555';
      mocks.native.mockReturnValue({ ...native, subscriptionId });
      registerNativeSubscriptionTenantLookup(id => (id === subscriptionId ? 'tenant' : undefined));
      allowCliOperations();
      mockCli({ ...account, id: subscriptionId });
      const operationStarted = deferred<void>();
      const operationResult = deferred<string>();
      const capability = withVerifiedCliCapabilityAccess(subscriptionId, async () => {
        operationStarted.resolve();
        return operationResult.promise;
      });
      await operationStarted.promise;

      const logout = runCommandAsync('az', ['logout']);
      await Promise.resolve();
      expect(mocks.execCommand).not.toHaveBeenCalledWith('/bundled/az', ['logout']);

      operationResult.resolve('started');
      await expect(capability).resolves.toEqual({ verified: true, value: 'started' });
      await expect(logout).resolves.toEqual(commandResult);
    });

    test.each([
      { user: { name: 'other@example.test' } },
      { tenantId: 'other-tenant' },
      { cloudName: 'AzureChinaCloud' },
      { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      null,
    ])('rejects changed final capability account data: %j', async changed => {
      const subscriptionId = '11111111-2222-3333-4444-555555555555';
      mocks.native.mockReturnValue({ ...native, subscriptionId });
      registerNativeSubscriptionTenantLookup(() => 'tenant');
      allowCliOperations();
      mockCli({ ...account, id: subscriptionId });
      const original = mocks.execCommand.getMockImplementation()!;
      mocks.execCommand.mockImplementation((command: string, args: string[]) =>
        args.includes('--output')
          ? Promise.resolve({
              stdout: JSON.stringify(
                changed ? { ...account, id: subscriptionId, ...changed } : null
              ),
              stderr: '',
            })
          : original(command, args)
      );
      const operation = vi.fn(async () => 'must not run');
      await expect(withVerifiedCliCapabilityAccess(subscriptionId, operation)).resolves.toEqual({
        verified: false,
      });
      expect(operation).not.toHaveBeenCalled();
    });

    test('does not spawn a namespace write when tenant reconciliation cancels its signal', async () => {
      acceptNative();
      const controller = new AbortController();
      registerNativeSubscriptionTenantLookup(
        () => 'tenant-a',
        () => true,
        () => {
          controller.abort(new Error('Selected tenant changed'));
          return true;
        }
      );
      mockCli({ ...account, tenantId: 'tenant-b' });
      const { createManagedNamespace } = await import('./az-namespaces');
      await expect(
        createManagedNamespace({
          clusterName: 'aks',
          resourceGroup: 'rg',
          namespaceName: 'ns',
          subscriptionId: 'sub',
          signal: controller.signal,
        })
      ).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining('Selected tenant changed'),
      });
      expect(
        mocks.execCommand.mock.calls.some(
          ([, args]) => args[0] === 'aks' && args[1] === 'namespace'
        )
      ).toBe(false);
    });

    test.each(['sign-out', 'replacement login', 'CLI block'])(
      'does not launch a capability after %s during the final account read',
      async change => {
        const subscriptionId = '11111111-2222-3333-4444-555555555555';
        mocks.native.mockReturnValue({ ...native, subscriptionId });
        registerNativeSubscriptionTenantLookup(id =>
          id === subscriptionId ? 'tenant' : undefined
        );
        allowCliOperations();
        mockCli({ ...account, id: subscriptionId });
        const original = mocks.execCommand.getMockImplementation()!;
        const entered = deferred<void>();
        const finalRead = deferred<{ stdout: string; stderr: string }>();
        mocks.execCommand.mockImplementation((command: string, args: string[]) => {
          if (args[0] === 'account' && args[1] === 'show' && args.includes('--output')) {
            entered.resolve();
            return finalRead.promise;
          }
          return original(command, args);
        });
        const operation = vi.fn(async () => 'should not run');
        const pending = withVerifiedCliCapabilityAccess(subscriptionId, operation);
        await entered.promise;
        if (change === 'CLI block') blockCliOperations();
        else {
          mocks.generation.mockReturnValue(1);
          if (change === 'sign-out') {
            mocks.native.mockReturnValue(undefined);
            mocks.signedOut.mockReturnValue(true);
          }
        }
        finalRead.resolve({
          stdout: JSON.stringify({ ...account, id: subscriptionId }),
          stderr: '',
        });

        await expect(pending).resolves.toEqual({ verified: false });
        expect(operation).not.toHaveBeenCalled();
      }
    );

    test('uses the discovered tenant for a guest subscription', async () => {
      acceptNative();
      registerNativeSubscriptionTenantLookup(id =>
        id.toLowerCase() === 'guest' ? 'guest-tenant' : undefined
      );
      mockCli({ ...account, id: 'guest', tenantId: 'GUEST-TENANT' });
      await expect(
        runCommandAsync('az', ['group', 'list', '--subscription', 'guest'])
      ).resolves.toEqual(commandResult);
      mockCli({ ...account, id: 'guest', tenantId: 'wrong-tenant' });
      await expect(
        runCommandAsync('az', ['group', 'list', '--subscription', 'guest'])
      ).resolves.toEqual(denied);
    });

    test('reconciles a verified login to another discovered tenant only', async () => {
      let selectedTenant = 'tenant-a';
      const discoveredTenants = new Set(['tenant-a', 'tenant-b']);
      const canReconcile = vi.fn((_subscriptionId: string, tenantId: string) =>
        discoveredTenants.has(tenantId)
      );
      const reconcile = vi.fn((_subscriptionId: string, tenantId: string) => {
        selectedTenant = tenantId;
        return true;
      });
      acceptNative();
      registerNativeSubscriptionTenantLookup(() => selectedTenant, canReconcile, reconcile);
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'login') return Promise.resolve({ stdout: '[{}]', stderr: '' });
        if (args[0] === 'account') {
          return Promise.resolve({
            stdout: JSON.stringify({ ...account, tenantId: 'tenant-b' }),
            stderr: '',
          });
        }
        if (args[0] === 'cloud') {
          return Promise.resolve({ stdout: '{"name":"AzureCloud"}', stderr: '' });
        }
        return Promise.resolve(commandResult);
      });

      await expect(runCommandAsync('az', ['login'])).resolves.toEqual({
        stdout: '[{}]',
        stderr: '',
      });
      expect(canReconcile).toHaveBeenCalledWith('sub', 'tenant-b');
      expect(reconcile).toHaveBeenCalledWith('sub', 'tenant-b');
      expect(selectedTenant).toBe('tenant-b');
    });

    test('rejects a verified login tenant absent from discovery', async () => {
      const selectedTenant = 'tenant-a';
      const canReconcile = vi.fn(() => false);
      const reconcile = vi.fn(() => true);
      acceptNative();
      registerNativeSubscriptionTenantLookup(() => selectedTenant, canReconcile, reconcile);
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'login') return Promise.resolve({ stdout: '[{}]', stderr: '' });
        if (args[0] === 'account') {
          return Promise.resolve({
            stdout: JSON.stringify({ ...account, tenantId: 'unknown-tenant' }),
            stderr: '',
          });
        }
        if (args[0] === 'cloud') {
          return Promise.resolve({ stdout: '{"name":"AzureCloud"}', stderr: '' });
        }
        return Promise.resolve(commandResult);
      });

      await expect(runCommandAsync('az', ['login'])).resolves.toEqual(denied);
      expect(canReconcile).toHaveBeenCalledWith('sub', 'unknown-tenant');
      expect(reconcile).not.toHaveBeenCalled();
      expect(selectedTenant).toBe('tenant-a');
    });

    test.each([
      [
        { ...account, tenantId: 'tenant-b', user: { name: 'other@example.com' } },
        { name: 'AzureCloud' },
      ],
      [{ ...account, tenantId: 'tenant-b' }, { name: 'AzureUSGovernment' }],
    ])('does not reconcile a rejected login identity', async (cliAccount, cloud) => {
      const canReconcile = vi.fn(() => true);
      const reconcile = vi.fn(() => true);
      acceptNative();
      registerNativeSubscriptionTenantLookup(() => 'tenant-a', canReconcile, reconcile);
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'login') return Promise.resolve({ stdout: '[{}]', stderr: '' });
        if (args[0] === 'account') {
          return Promise.resolve({ stdout: JSON.stringify(cliAccount), stderr: '' });
        }
        if (args[0] === 'cloud') {
          return Promise.resolve({ stdout: JSON.stringify(cloud), stderr: '' });
        }
        return Promise.resolve(commandResult);
      });

      await expect(runCommandAsync('az', ['login'])).resolves.toEqual(denied);
      expect(reconcile).not.toHaveBeenCalled();
    });

    test('does not reconcile after the native generation changes during login verification', async () => {
      const canReconcile = vi.fn(() => true);
      const reconcile = vi.fn(() => true);
      acceptNative();
      registerNativeSubscriptionTenantLookup(() => 'tenant-a', canReconcile, reconcile);
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'login') return Promise.resolve({ stdout: '[{}]', stderr: '' });
        if (args[0] === 'account') {
          return Promise.resolve({
            stdout: JSON.stringify({ ...account, tenantId: 'tenant-b' }),
            stderr: '',
          });
        }
        if (args[0] === 'cloud') {
          return Promise.resolve({ stdout: '{"name":"AzureCloud"}', stderr: '' });
        }
        return Promise.resolve(commandResult);
      });
      mocks.generation.mockReturnValueOnce(0).mockReturnValue(1);

      await expect(runCommandAsync('az', ['login'])).resolves.toEqual(denied);
      expect(canReconcile).toHaveBeenCalledWith('sub', 'tenant-b');
      expect(reconcile).not.toHaveBeenCalled();
    });

    test('reconciles the effective binding and selected native account together', async () => {
      const {
        getAzureAccountGeneration,
        getNativeSubscriptionTenant,
        setNativeSubscriptionTenants,
      } = await import('./az-token');
      const subscriptionId = '11111111-2222-3333-4444-555555555555';
      const tenantA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const tenantB = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
      mocks.native.mockReturnValue({
        ...native,
        subscriptionId,
        tenantId: tenantA,
      });
      mocks.nativeSession.mockReturnValue(true);
      allowCliOperations();
      expect(
        setNativeSubscriptionTenants(
          [{ id: subscriptionId, tenant: tenantA, tenants: [tenantA, tenantB] }],
          getAzureAccountGeneration()
        )
      ).toBe(true);
      mocks.updateNativeAccountTenant.mockClear();
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'login') return Promise.resolve({ stdout: '[{}]', stderr: '' });
        if (args[0] === 'account') {
          return Promise.resolve({
            stdout: JSON.stringify({
              ...account,
              id: subscriptionId,
              tenantId: tenantB,
            }),
            stderr: '',
          });
        }
        if (args[0] === 'cloud') {
          return Promise.resolve({ stdout: '{"name":"AzureCloud"}', stderr: '' });
        }
        return Promise.resolve(commandResult);
      });

      await expect(runCommandAsync('az', ['login'])).resolves.toEqual({
        stdout: '[{}]',
        stderr: '',
      });
      expect(getNativeSubscriptionTenant(subscriptionId)).toBe(tenantB);
      expect(mocks.updateNativeAccountTenant).toHaveBeenCalledWith(subscriptionId, tenantB);
    });

    test('reconciles a verified non-default subscription without changing native account metadata', async () => {
      const {
        getAzureAccountGeneration,
        getNativeSubscriptionTenant,
        setNativeSubscriptionTenants,
      } = await import('./az-token');
      const defaultSubscription = '11111111-2222-3333-4444-555555555555';
      const targetSubscription = '22222222-3333-4444-5555-666666666666';
      const tenantA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const tenantB = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
      mocks.native.mockReturnValue({
        ...native,
        subscriptionId: defaultSubscription,
        tenantId: tenantA,
      });
      mocks.nativeSession.mockReturnValue(true);
      allowCliOperations();
      expect(
        setNativeSubscriptionTenants(
          [
            { id: defaultSubscription, tenant: tenantA },
            {
              id: targetSubscription,
              tenant: tenantA,
              tenants: [tenantA, tenantB],
            },
          ],
          getAzureAccountGeneration()
        )
      ).toBe(true);
      mocks.updateNativeAccountTenant.mockClear();
      let targetTenant = tenantB;
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'account') {
          return Promise.resolve({
            stdout: JSON.stringify({
              ...account,
              id: targetSubscription,
              tenantId: targetTenant,
            }),
            stderr: '',
          });
        }
        if (args[0] === 'cloud') {
          return Promise.resolve({ stdout: '{"name":"AzureCloud"}', stderr: '' });
        }
        return Promise.resolve(commandResult);
      });

      await expect(
        runCommandAsync('az', ['group', 'list', '--subscription', targetSubscription])
      ).resolves.toEqual(commandResult);
      expect(getNativeSubscriptionTenant(targetSubscription)).toBe(tenantB);
      expect(mocks.updateNativeAccountTenant).not.toHaveBeenCalled();

      targetTenant = tenantA;
      await expect(
        withVerifiedCliBatch(targetSubscription, run =>
          run(['group', 'list', '--subscription', targetSubscription])
        )
      ).resolves.toEqual(commandResult);
      expect(getNativeSubscriptionTenant(targetSubscription)).toBe(tenantA);
      expect(mocks.updateNativeAccountTenant).not.toHaveBeenCalled();
    });

    test('uses real token discovery bindings and rejects removed or stale mappings', async () => {
      const { getAzureAccountGeneration, setNativeSubscriptionTenants } = await import(
        './az-token'
      );
      const guestId = '11111111-2222-3333-4444-555555555555';
      const guestTenant = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      acceptNative();
      mocks.nativeSession.mockReturnValue(true);
      expect(
        setNativeSubscriptionTenants(
          [{ id: guestId, tenant: guestTenant }],
          getAzureAccountGeneration()
        )
      ).toBe(true);
      mockCli({ ...account, id: guestId, tenantId: guestTenant });
      await expect(
        runCommandAsync('az', ['group', 'list', '--subscription', guestId])
      ).resolves.toEqual(commandResult);
      expect(setNativeSubscriptionTenants([], getAzureAccountGeneration())).toBe(true);
      await expect(
        runCommandAsync('az', ['group', 'list', '--subscription', guestId])
      ).resolves.toEqual(denied);

      expect(
        setNativeSubscriptionTenants(
          [{ id: guestId, tenant: guestTenant }],
          getAzureAccountGeneration()
        )
      ).toBe(true);
      let finishAccount!: (value: { stdout: string; stderr: string }) => void;
      mocks.execCommand.mockImplementation((_command: string, args: string[]) =>
        args[0] === 'account'
          ? new Promise(resolve => (finishAccount = resolve))
          : Promise.resolve({ stdout: '{"name":"AzureCloud"}', stderr: '' })
      );
      const operation = runCommandAsync('az', ['group', 'list', '--subscription', guestId]);
      mocks.generation.mockReturnValue(1);
      finishAccount({
        stdout: JSON.stringify({ ...account, id: guestId, tenantId: guestTenant }),
        stderr: '',
      });
      await expect(operation).resolves.toEqual(denied);
    });

    test('rejects subscriptions absent from native discovery', async () => {
      acceptNative();
      mockCli({ ...account, id: 'unknown' });
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      mockCli();
      registerNativeSubscriptionTenantLookup(() => undefined);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
    });

    test('verifies every subscription for multi-subscription commands', async () => {
      acceptNative();
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'cloud')
          return Promise.resolve({ stdout: '{"name":"AzureCloud"}', stderr: '' });
        if (args[0] === 'account') {
          return Promise.resolve({
            stdout: JSON.stringify({ ...account, id: args[3] }),
            stderr: '',
          });
        }
        return Promise.resolve(commandResult);
      });
      await expect(
        runCommandAsync('az', ['graph', 'query', '--subscriptions', 'sub', 'unknown'])
      ).resolves.toEqual(denied);
    });

    test('does not allow an unverified tenant selector', async () => {
      acceptNative();
      mockCli();
      await expect(
        runCommandAsync('az', ['account', 'get-access-token', '--tenant', 'other'])
      ).resolves.toEqual(denied);
      expect(mocks.execCommand).not.toHaveBeenCalled();
    });

    test.each([
      [{ ...account, user: { name: 'other@example.com' } }, { name: 'AzureCloud' }],
      [{ ...account, tenantId: 'other' }, { name: 'AzureCloud' }],
      [{ ...account, cloudName: 'AzureUSGovernment' }, { name: 'AzureCloud' }],
      [account, { name: 'AzureUSGovernment' }],
      [{ ...account, user: {} }, { name: 'AzureCloud' }],
      [{ ...account, cloudName: undefined }, { name: 'AzureCloud' }],
      [null, { name: 'AzureCloud' }],
    ])('blocks operations when account or cloud cannot be verified', async (cliAccount, cloud) => {
      acceptNative();
      mockCli(cliAccount, cloud);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      expect(mocks.execCommand).toHaveBeenCalledTimes(2);
    });

    test('blocks lookup errors and malformed identity responses', async () => {
      acceptNative();
      mocks.execCommand.mockResolvedValue({ stdout: '{bad', stderr: '' });
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      mocks.execCommand.mockResolvedValue({ stdout: '{}', stderr: 'Command exited with code 1' });
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
    });

    test('blocks native login pending and explicitly signed out', async () => {
      mocks.nativeSession.mockReturnValue(true);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      mocks.nativeSession.mockReturnValue(false);
      mocks.signedOut.mockReturnValue(true);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      expect(mocks.execCommand).not.toHaveBeenCalled();
    });

    test('permits CLI fallback after a terminal native login error', async () => {
      mocks.nativeError.mockReturnValue('Device authorization denied');
      mocks.execCommand.mockResolvedValue(commandResult);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(commandResult);
    });

    test('requires explicit CLI sign-in after a real native device login fails', async () => {
      vi.stubGlobal('pluginAzureOAuth', {
        startAzureLogin: vi.fn().mockResolvedValue({
          success: true,
          prompt: {
            userCode: 'code',
            verificationUri: 'https://microsoft.com/devicelogin',
            message: 'Enter code',
          },
        }),
        getAzureLoginStatus: vi.fn().mockResolvedValue({
          success: false,
          error: 'Denied',
        }),
        getAzureToken: vi.fn(),
        cancelAzureLogin: vi.fn().mockResolvedValue({ success: true }),
        logoutAzure: vi.fn().mockResolvedValue({ success: true }),
      });
      const nativeAuth = await vi.importActual<typeof import('./native-auth')>('./native-auth');
      mocks.native.mockImplementation(nativeAuth.getNativeAccount);
      mocks.generation.mockImplementation(nativeAuth.getNativeAuthGeneration);
      mocks.nativeSession.mockImplementation(nativeAuth.hasNativeSession);
      mocks.signedOut.mockImplementation(nativeAuth.isAzureExplicitlySignedOut);
      mocks.execCommand.mockResolvedValue(commandResult);
      const open = vi.spyOn(window, 'open').mockImplementation(() => null);
      try {
        nativeAuth.allowAzureCliFallback();
        await nativeAuth.initiateNativeLogin();
        await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
        await nativeAuth.synchronizeNativeLogin();
        expect(nativeAuth.getNativeLoginError()).toBe('Denied');
        expect(nativeAuth.hasNativeSession()).toBe(false);
        await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
        mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
          if (args[0] === 'login') return Promise.resolve({ stdout: '[{}]', stderr: '' });
          if (args[0] === 'account' && args[1] === 'show') {
            return Promise.resolve({ stdout: '{"id":"sub","tenantId":"tenant"}', stderr: '' });
          }
          return Promise.resolve(commandResult);
        });
        await expect(runCommandAsync('az', ['login'])).resolves.toEqual({
          stdout: '[{}]',
          stderr: '',
        });
        await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
        nativeAuth.allowAzureCliFallback();
        allowCliOperations();
        await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(commandResult);
      } finally {
        await nativeAuth.logoutNative();
        open.mockRestore();
        vi.unstubAllGlobals();
      }
    });

    test('allows metadata and non-az commands while signed out', async () => {
      mocks.signedOut.mockReturnValue(true);
      mocks.execCommand.mockResolvedValue(commandResult);
      for (const args of [['version'], ['cloud', 'show'], ['account', 'show'], ['logout']]) {
        await expect(runCommandAsync('az', args)).resolves.toEqual(commandResult);
      }
      await expect(runCommandAsync('kubectl', ['get', 'pods'])).resolves.toEqual(commandResult);
    });

    test('keeps CLI operations blocked after skipping while metadata remains available', async () => {
      mocks.execCommand.mockResolvedValue(commandResult);
      blockCliOperations();
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      await expect(runCommandAsync('az', ['version'])).resolves.toEqual(commandResult);
      await expect(runCommandAsync('az', ['account', 'show'])).resolves.toEqual(commandResult);
      await expect(runCommandAsync('az', ['cloud', 'show'])).resolves.toEqual(commandResult);
      await expect(runCommandAsync('az', ['logout'])).resolves.toEqual(commandResult);
    });

    test('a successful late CLI login cannot undo a skipped step', async () => {
      let finishLogin!: (value: { stdout: string; stderr: string }) => void;
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'login') return new Promise(resolve => (finishLogin = resolve));
        if (args[0] === 'account') {
          return Promise.resolve({ stdout: '{"id":"sub","tenantId":"tenant"}', stderr: '' });
        }
        return Promise.resolve(commandResult);
      });
      const login = runCommandAsync('az', ['login']);
      blockCliOperations();
      finishLogin({ stdout: '[{}]', stderr: '' });
      await login;
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
    });

    test('a new successful CLI sign-in and explicit permission restores access', async () => {
      blockCliOperations();
      mocks.execCommand
        .mockResolvedValueOnce({ stdout: '[{}]', stderr: '' })
        .mockResolvedValueOnce({ stdout: '{"id":"sub","tenantId":"tenant"}', stderr: '' })
        .mockResolvedValue(commandResult);
      await expect(runCommandAsync('az', ['login'])).resolves.toEqual({
        stdout: '[{}]',
        stderr: '',
      });
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      allowCliOperations();
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(commandResult);
    });

    test('blocks during login and after failure until a successful retry', async () => {
      let finishLogin!: (value: { stdout: string; stderr: string }) => void;
      mocks.execCommand.mockImplementation((_command: string, args: string[]) =>
        args[0] === 'login'
          ? new Promise(resolve => {
              finishLogin = resolve;
            })
          : Promise.resolve(commandResult)
      );
      const login = runCommandAsync('az', ['login', '--output', 'json']);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      finishLogin({ stdout: '', stderr: 'ERROR: login failed' });
      await login;
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      mocks.execCommand
        .mockResolvedValueOnce({ stdout: '[{}]', stderr: '' })
        .mockResolvedValueOnce({ stdout: '{"id":"sub","tenantId":"tenant"}', stderr: '' });
      await runCommandAsync('az', ['login', '--output', 'json']);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(commandResult);
    });

    test('a successful login queued behind logout clears its failure barrier', async () => {
      const logoutResult = deferred<typeof commandResult>();
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'logout') return logoutResult.promise;
        if (args[0] === 'login') return Promise.resolve({ stdout: '[{}]', stderr: '' });
        if (args[0] === 'account' && args[1] === 'show') {
          return Promise.resolve({ stdout: '{"id":"sub","tenantId":"tenant"}', stderr: '' });
        }
        return Promise.resolve(commandResult);
      });
      const logout = runCommandAsync('az', ['logout']);
      const login = runCommandAsync('az', ['login']);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      expect(mocks.execCommand).not.toHaveBeenCalledWith('/bundled/az', ['login']);
      logoutResult.resolve(commandResult);
      await logout;
      await expect(login).resolves.toEqual({ stdout: '[{}]', stderr: '' });
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(commandResult);
    });

    test('a newer logout cannot be undone by an in-flight login', async () => {
      const loginResult = deferred<typeof commandResult>();
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'login') return loginResult.promise;
        if (args[0] === 'account' && args[1] === 'show') {
          return Promise.resolve({ stdout: '{"id":"sub","tenantId":"tenant"}', stderr: '' });
        }
        return Promise.resolve(commandResult);
      });
      const login = runCommandAsync('az', ['login']);
      const logout = runCommandAsync('az', ['logout']);
      loginResult.resolve({ stdout: '[{}]', stderr: '' });
      await expect(login).resolves.toEqual(denied);
      await expect(logout).resolves.toEqual(commandResult);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
    });

    test('a successful queued login recovers from an earlier failed login', async () => {
      const firstResult = deferred<typeof commandResult>();
      let loginCalls = 0;
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'login') {
          return ++loginCalls === 1
            ? firstResult.promise
            : Promise.resolve({ stdout: '[{}]', stderr: '' });
        }
        if (args[0] === 'account' && args[1] === 'show') {
          return Promise.resolve({ stdout: '{"id":"sub","tenantId":"tenant"}', stderr: '' });
        }
        return Promise.resolve(commandResult);
      });
      const first = runCommandAsync('az', ['login']);
      const second = runCommandAsync('az', ['login']);
      firstResult.resolve({ stdout: '', stderr: 'ERROR: failed' });
      await first;
      await expect(second).resolves.toEqual({ stdout: '[{}]', stderr: '' });
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(commandResult);
    });

    test('rejects a stale verification when login starts during the check', async () => {
      acceptNative();
      let finishAccount!: (value: { stdout: string; stderr: string }) => void;
      let finishLogin!: (value: { stdout: string; stderr: string }) => void;
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'account') return new Promise(resolve => (finishAccount = resolve));
        if (args[0] === 'login') return new Promise(resolve => (finishLogin = resolve));
        return Promise.resolve({ stdout: JSON.stringify({ name: 'AzureCloud' }), stderr: '' });
      });
      const operation = runCommandAsync('az', ['group', 'list']);
      const login = runCommandAsync('az', ['login']);
      finishAccount({ stdout: JSON.stringify(account), stderr: '' });
      await expect(operation).resolves.toEqual(denied);
      finishLogin({ stdout: '', stderr: 'ERROR: failed' });
      await login;
    });

    test('rejects a native session change during verification', async () => {
      mocks.generation.mockReturnValue(1);
      acceptNative();
      mockCli();
      mocks.generation.mockReturnValueOnce(1).mockReturnValue(2);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      expect(mocks.execCommand).toHaveBeenCalledTimes(2);
    });

    test('requires explicit CLI sign-in approval for each native generation', async () => {
      mocks.native.mockReturnValue(native);
      mockCli();
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      expect(mocks.execCommand).not.toHaveBeenCalled();
      allowCliOperations();
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(commandResult);
      mocks.generation.mockReturnValue(1);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      allowCliOperations();
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(commandResult);
    });

    test('blocks other operations while CLI account selection is changing', async () => {
      let finishSet!: (value: { stdout: string; stderr: string }) => void;
      mocks.execCommand.mockImplementation((_command: string, args: string[]) =>
        args[0] === 'account' && args[1] === 'set'
          ? new Promise(resolve => (finishSet = resolve))
          : Promise.resolve(commandResult)
      );
      const change = runCommandAsync('az', ['account', 'set', '--subscription', 'sub']);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      finishSet(commandResult);
      await change;
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(commandResult);
    });

    test.each([
      ['login'],
      ['logout'],
      ['account', 'set', '--subscription', 'sub'],
      ['account', 'clear'],
      ['account', 'list', '--refresh'],
      ['cloud', 'set', '--name', 'AzureCloud'],
      ['cloud', 'register', '--name', 'custom'],
      ['cloud', 'unregister', '--name', 'custom'],
      ['cloud', 'update', '--name', 'custom'],
    ])('reserves writer %j until every running reader completes', async (...args) => {
      const readers = [deferred<typeof commandResult>(), deferred<typeof commandResult>()];
      let started = 0;
      mocks.execCommand.mockImplementation((_command: string, commandArgs: string[]) => {
        if (commandArgs[0] === 'group') return readers[started++].promise;
        if (commandArgs[0] === 'login') return Promise.resolve({ stdout: '[{}]', stderr: '' });
        if (commandArgs[0] === 'account' && commandArgs[1] === 'show') {
          return Promise.resolve({ stdout: '{"id":"sub","tenantId":"tenant"}', stderr: '' });
        }
        return Promise.resolve(commandResult);
      });
      const first = runCommandAsync('az', ['group', 'list']);
      const second = runCommandAsync('az', ['group', 'show']);
      const writer = runCommandAsync('az', args);
      expect(mocks.execCommand).not.toHaveBeenCalledWith('/bundled/az', args);
      await expect(runCommandAsync('az', ['group', 'create'])).resolves.toEqual(denied);
      await expect(runCommandAsync('az', ['version'])).resolves.toEqual(commandResult);
      await expect(runCommandAsync('az', ['cloud', 'show'])).resolves.toEqual(commandResult);
      readers[0].resolve(commandResult);
      await first;
      expect(mocks.execCommand).not.toHaveBeenCalledWith('/bundled/az', args);
      readers[1].resolve(commandResult);
      await second;
      await writer;
      expect(mocks.execCommand).toHaveBeenCalledWith('/bundled/az', args);
    });

    test('serializes writers and releases the lease when a writer rejects', async () => {
      const firstWriter = deferred<typeof commandResult>();
      mocks.execCommand.mockImplementation((_command: string, args: string[]) =>
        args[0] === 'account' && args[1] === 'set'
          ? firstWriter.promise
          : Promise.resolve(commandResult)
      );
      const first = runCommandAsync('az', ['account', 'set', '-s', 'sub']);
      const second = runCommandAsync('az', ['cloud', 'set', '--name', 'AzureCloud']);
      expect(mocks.execCommand).not.toHaveBeenCalledWith('/bundled/az', [
        'cloud',
        'set',
        '--name',
        'AzureCloud',
      ]);
      firstWriter.reject(new Error('bridge failed'));
      await expect(first).rejects.toThrow('bridge failed');
      await expect(second).resolves.toEqual(commandResult);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(commandResult);
    });

    test('keeps metadata available while a writer is running', async () => {
      const writerResult = deferred<typeof commandResult>();
      mocks.execCommand.mockImplementation((_command: string, args: string[]) =>
        args[0] === 'cloud' && args[1] === 'set'
          ? writerResult.promise
          : Promise.resolve(commandResult)
      );
      const writer = runCommandAsync('az', ['cloud', 'set', '--name', 'AzureCloud']);
      await expect(runCommandAsync('az', ['account', 'show'])).resolves.toEqual(commandResult);
      await expect(runCommandAsync('az', ['cloud', 'show'])).resolves.toEqual(commandResult);
      await expect(runCommandAsync('az', ['version'])).resolves.toEqual(commandResult);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      writerResult.resolve(commandResult);
      await writer;
    });

    test('releases reader lease after command rejection', async () => {
      const reader = deferred<typeof commandResult>();
      mocks.execCommand.mockImplementation((_command: string, args: string[]) =>
        args[0] === 'group' ? reader.promise : Promise.resolve(commandResult)
      );
      const operation = runCommandAsync('az', ['group', 'list']);
      const writer = runCommandAsync('az', ['logout']);
      reader.reject(new Error('bridge failed'));
      await expect(operation).rejects.toThrow('bridge failed');
      await expect(writer).resolves.toEqual(commandResult);
    });

    test('waits for all identity lookups even when one rejects before starting a writer', async () => {
      acceptNative();
      const cloud = deferred<typeof commandResult>();
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'account') return Promise.reject(new Error('lookup failed'));
        if (args[0] === 'cloud' && args[1] === 'show') return cloud.promise;
        return Promise.resolve(commandResult);
      });
      const operation = runCommandAsync('az', ['group', 'list']);
      const writer = runCommandAsync('az', ['logout']);
      await Promise.resolve();
      expect(mocks.execCommand).not.toHaveBeenCalledWith('/bundled/az', ['logout']);
      cloud.resolve({ stdout: '{"name":"AzureCloud"}', stderr: '' });
      await expect(operation).resolves.toEqual(denied);
      await expect(writer).resolves.toEqual(commandResult);
    });

    test('revalidates a queued writer against the current native generation', async () => {
      acceptNative();
      const reader = deferred<typeof commandResult>();
      const readerStarted = deferred<void>();
      mockCli();
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'group') {
          readerStarted.resolve();
          return reader.promise;
        }
        if (args[0] === 'account' && args[1] === 'show')
          return Promise.resolve({ stdout: JSON.stringify(account), stderr: '' });
        if (args[0] === 'cloud')
          return Promise.resolve({ stdout: '{"name":"AzureCloud"}', stderr: '' });
        return Promise.resolve(commandResult);
      });
      const operation = runCommandAsync('az', ['group', 'list']);
      await readerStarted.promise;
      const writer = runCommandAsync('az', ['account', 'set', '-s', 'sub']);
      mocks.generation.mockReturnValue(1);
      reader.resolve(commandResult);
      await operation;
      await expect(writer).resolves.toEqual(denied);
      expect(mocks.execCommand).not.toHaveBeenCalledWith('/bundled/az', [
        'account',
        'set',
        '-s',
        'sub',
      ]);
    });

    test('verifies the short account-set subscription selector before mutation', async () => {
      acceptNative();
      mockCli();
      await expect(runCommandAsync('az', ['account', 'set', '-s', 'sub'])).resolves.toEqual(
        commandResult
      );
      expect(mocks.execCommand).toHaveBeenCalledWith('/bundled/az', [
        'account',
        'show',
        '--subscription',
        'sub',
        '-o',
        'json',
      ]);
    });

    test.each([['-ssub'], ['-s=sub'], ['--subscription=sub']])(
      'verifies account-set selector %j',
      async selector => {
        acceptNative();
        mockCli();
        await expect(runCommandAsync('az', ['account', 'set', selector])).resolves.toEqual(
          commandResult
        );
        expect(mocks.execCommand).toHaveBeenCalledWith('/bundled/az', [
          'account',
          'show',
          '--subscription',
          'sub',
          '-o',
          'json',
        ]);
      }
    );

    test('rejects account-set selectors it cannot verify', async () => {
      acceptNative();
      mockCli();
      await expect(runCommandAsync('az', ['account', 'set', '--sub', 'other'])).resolves.toEqual(
        denied
      );
      expect(mocks.execCommand).not.toHaveBeenCalled();
    });

    test('rechecks CLI identity after a preceding writer changes it', async () => {
      acceptNative();
      const firstWriter = deferred<typeof commandResult>();
      const firstStarted = deferred<void>();
      let currentAccount = account;
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'account' && args[1] === 'show')
          return Promise.resolve({ stdout: JSON.stringify(currentAccount), stderr: '' });
        if (args[0] === 'cloud' && args[1] === 'show')
          return Promise.resolve({ stdout: '{"name":"AzureCloud"}', stderr: '' });
        if (args[0] === 'account' && args[1] === 'clear') {
          firstStarted.resolve();
          return firstWriter.promise;
        }
        return Promise.resolve(commandResult);
      });
      const first = runCommandAsync('az', ['account', 'clear']);
      await firstStarted.promise;
      const second = runCommandAsync('az', ['cloud', 'set', '--name', 'AzureCloud']);
      currentAccount = { ...account, user: { name: 'other@example.com' } };
      firstWriter.resolve(commandResult);
      await first;
      await expect(second).resolves.toEqual(denied);
      expect(mocks.execCommand).not.toHaveBeenCalledWith('/bundled/az', [
        'cloud',
        'set',
        '--name',
        'AzureCloud',
      ]);
    });

    test('keeps the login barrier until post-login verification completes', async () => {
      acceptNative();
      let finishAccount!: (value: { stdout: string; stderr: string }) => void;
      mocks.execCommand.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'login') return Promise.resolve({ stdout: '[{}]', stderr: '' });
        if (args[0] === 'account') return new Promise(resolve => (finishAccount = resolve));
        if (args[0] === 'cloud') {
          return Promise.resolve({ stdout: '{"name":"AzureCloud"}', stderr: '' });
        }
        return Promise.resolve(commandResult);
      });
      const login = runCommandAsync('az', ['login']);
      await Promise.resolve();
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
      finishAccount({ stdout: JSON.stringify(account), stderr: '' });
      await expect(login).resolves.toEqual({ stdout: '[{}]', stderr: '' });
      expect(mocks.execCommand).toHaveBeenCalledWith('/bundled/az', [
        'account',
        'show',
        '--subscription',
        native.subscriptionId,
        '-o',
        'json',
      ]);
    });

    test('returns verified partial login results without stale tenant errors', async () => {
      acceptNative();
      mockCli();
      mocks.execCommand.mockImplementationOnce(() =>
        Promise.resolve({
          stdout: '[{"id":"sub","tenantId":"tenant"}]',
          stderr: 'ERROR: authentication failed for an unrelated tenant',
        })
      );

      await expect(runCommandAsync('az', ['login'])).resolves.toEqual({
        stdout: '[{"id":"sub","tenantId":"tenant"}]',
        stderr: '',
      });
    });

    test('keeps operations blocked when login succeeds but account verification fails', async () => {
      acceptNative();
      mockCli({ ...account, user: { name: 'other@example.com' } });
      mocks.execCommand.mockImplementationOnce(() =>
        Promise.resolve({ stdout: '[{}]', stderr: '' })
      );
      await expect(runCommandAsync('az', ['login'])).resolves.toEqual(denied);
      await expect(runCommandAsync('az', ['group', 'list'])).resolves.toEqual(denied);
    });
  });

  test('returns success without a parser', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: '', stderr: 'WARNING: harmless' });

    await expect(runAzCommand(['mock'], 'Running:', 'run mock')).resolves.toEqual({
      success: true,
      data: undefined,
    });
  });

  test('returns an authentication error for relogin guidance', async () => {
    mocks.execCommand.mockResolvedValue({
      stdout: '',
      stderr: 'Please run "az login" to setup account.',
    });

    await expect(runAzCommand(['mock'], 'Running:', 'run mock')).resolves.toEqual({
      success: false,
      error: 'Authentication required. Please log in to Azure CLI: az login',
    });
  });

  test('allows a stderr callback to return a domain result', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: '', stderr: 'WARNING: partial result' });

    await expect(
      runAzCommand(['mock'], 'Running:', 'run mock', undefined, () => ({
        success: true,
        warning: true,
      }))
    ).resolves.toEqual({ success: true, warning: true });
  });

  test('falls through when a stderr callback declines the result', async () => {
    mocks.execCommand.mockResolvedValue({ stdout: '', stderr: 'ERROR: failed' });

    await expect(
      runAzCommand(['mock'], 'Running:', 'run mock', undefined, () => null)
    ).resolves.toEqual({
      success: false,
      error: 'Failed to run mock: ERROR: failed',
    });
  });

  test('reports parser and command exceptions', async () => {
    mocks.execCommand
      .mockResolvedValueOnce({ stdout: '{invalid', stderr: '' })
      .mockRejectedValueOnce('private failure');

    await expect(
      runAzCommand(['mock'], 'Running:', 'parse output', stdout => JSON.parse(stdout))
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Failed to parse output'),
    });
    await expect(runAzCommand(['mock'], 'Running:', 'run mock')).resolves.toEqual({
      success: false,
      error: 'Failed to run mock: Unknown error',
    });
  });
});
