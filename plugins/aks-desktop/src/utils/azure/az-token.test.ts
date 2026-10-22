// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { TokenCredential } from '@azure/identity';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execCommand: vi.fn() }));

vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.execCommand }));
vi.mock('./az-cli-path', () => ({ getAzCommand: () => 'az' }));

import {
  ARM_SCOPE,
  azCliCredential,
  AzTokenError,
  createAzCliCredential,
  getAzToken,
} from './az-token';

const nowSeconds = () => Math.floor(Date.now() / 1000);

function cliToken(token: string, expiresInSeconds = 3600) {
  return {
    stdout: JSON.stringify({
      accessToken: token,
      expires_on: nowSeconds() + expiresInSeconds,
      tenant: 't',
      tokenType: 'Bearer',
    }),
    stderr: '',
  };
}

beforeEach(() => {
  mocks.execCommand.mockReset();
  azCliCredential.clearCache();
});

describe('createAzCliCredential', () => {
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
