// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initiateDeviceFlow, refreshDeviceToken, waitForDeviceTokens } from './github-device-flow';
import { GitHubOAuthError, postGitHubOAuth } from './github-oauth-transport';

vi.mock('./github-oauth-transport', async importOriginal => ({
  ...(await importOriginal<typeof import('./github-oauth-transport')>()),
  postGitHubOAuth: vi.fn(),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ getHeadlampAPIHeaders: vi.fn() }));
const post = vi.mocked(postGitHubOAuth);
const signal = () => new AbortController().signal;
const grant = () => ({
  device_code: 'private-device',
  user_code: 'ABCD-EFGH',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
});
const tokens = () => ({
  access_token: 'private-access',
  refresh_token: 'private-refresh',
  expires_in: 28800,
  token_type: 'bearer',
});

async function authorization() {
  post.mockResolvedValueOnce(grant());
  return initiateDeviceFlow(signal());
}

describe('GitHub App device protocol', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    post.mockReset();
    vi.useRealTimers();
  });

  it('requests expiring tokens with offline_access, not broad GitHub permission scopes', async () => {
    const auth = await authorization();
    const [endpoint, form] = post.mock.calls[0];
    expect(endpoint).toBe('device');
    expect(Object.fromEntries(form)).toEqual({
      client_id: 'Iv23liWWbvrfIrA6WWj5',
      scope: 'offline_access',
    });
    expect(auth).toEqual({
      deviceCode: 'private-device',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: 900000,
      intervalMs: 5000,
    });
  });

  it.each([
    { verification_uri: 'https://evil.example/device' },
    { verification_uri: 'https://github.com/login/device?private=1' },
    { device_code: '' },
    { user_code: '' },
    { interval: 0 },
    { interval: Infinity },
    { expires_in: -1 },
  ])('rejects untrusted or malformed authorization %j', async overrides => {
    post.mockResolvedValueOnce({ ...grant(), ...overrides });
    await expect(initiateDeviceFlow(signal())).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('waits the full first interval, then polls sequentially and returns validated expiring tokens', async () => {
    const auth = await authorization();
    post.mockRejectedValueOnce(new GitHubOAuthError('authorization_pending'));
    post.mockResolvedValueOnce(tokens());
    const result = waitForDeviceTokens(auth, signal());
    await vi.advanceTimersByTimeAsync(4999);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toEqual({
      accessToken: 'private-access',
      refreshToken: 'private-refresh',
      expiresIn: 28800,
    });
    expect(Object.fromEntries(post.mock.calls[1][1])).toEqual({
      client_id: 'Iv23liWWbvrfIrA6WWj5',
      device_code: 'private-device',
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
  });

  it('uses the longer returned slow_down interval and never overlaps a pending request', async () => {
    const auth = await authorization();
    post.mockRejectedValueOnce(new GitHubOAuthError('slow_down', { intervalMs: 20000 }));
    let resolve!: (value: unknown) => void;
    post.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const result = waitForDeviceTokens(auth, signal());
    await vi.advanceTimersByTimeAsync(24999);
    expect(post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(3);
    resolve(tokens());
    await expect(result).resolves.toMatchObject({ accessToken: 'private-access' });
  });

  it('respects transient Retry-After and stops at the original grant deadline', async () => {
    const auth = await authorization();
    post.mockRejectedValue(
      new GitHubOAuthError('http_error', { status: 429, retryable: true, retryAfterMs: 1000000 })
    );
    const result = expect(waitForDeviceTokens(auth, signal())).rejects.toMatchObject({
      code: 'expired_token',
    });
    await vi.advanceTimersByTimeAsync(900000);
    await result;
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('caps a server grant at fifteen minutes from issuance', async () => {
    post.mockResolvedValueOnce({ ...grant(), expires_in: 9000 });
    const auth = await initiateDeviceFlow(signal());
    expect(auth.expiresAt).toBe(900000);
  });

  it.each(['access_denied', 'expired_token', 'device_flow_disabled'] as const)(
    'stops on %s',
    async code => {
      const auth = await authorization();
      post.mockRejectedValueOnce(new GitHubOAuthError(code));
      const result = expect(waitForDeviceTokens(auth, signal())).rejects.toMatchObject({ code });
      await vi.advanceTimersByTimeAsync(5000);
      await result;
      expect(post).toHaveBeenCalledTimes(2);
    }
  );

  it('rejects late approval after cancellation without another poll', async () => {
    const auth = await authorization();
    let resolve!: (value: unknown) => void;
    post.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const controller = new AbortController();
    const result = expect(waitForDeviceTokens(auth, controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    await vi.advanceTimersByTimeAsync(5000);
    controller.abort();
    resolve(tokens());
    await result;
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('refreshes without a secret and bounds transient retries at three attempts', async () => {
    post.mockRejectedValueOnce(new GitHubOAuthError('network_error', { retryable: true }));
    post.mockRejectedValueOnce(
      new GitHubOAuthError('http_error', { status: 503, retryable: true })
    );
    post.mockResolvedValueOnce(tokens());
    const result = refreshDeviceToken('private-refresh', signal());
    await vi.advanceTimersByTimeAsync(999);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toMatchObject({ refreshToken: 'private-refresh' });
    expect(post).toHaveBeenCalledTimes(3);
    expect(Object.fromEntries(post.mock.calls[0][1])).toEqual({
      client_id: 'Iv23liWWbvrfIrA6WWj5',
      grant_type: 'refresh_token',
      refresh_token: 'private-refresh',
    });
  });

  it('doubles transient polling backoff up to sixty seconds', async () => {
    const auth = await authorization();
    const times: number[] = [];
    post.mockImplementation(async () => {
      times.push(Date.now());
      if (times.length < 6) throw new GitHubOAuthError('network_error', { retryable: true });
      return tokens();
    });
    const result = waitForDeviceTokens(auth, signal());
    await vi.advanceTimersByTimeAsync(195000);
    await expect(result).resolves.toMatchObject({ accessToken: 'private-access' });
    expect(times).toEqual([5000, 15000, 35000, 75000, 135000, 195000]);
  });

  it('aborts an in-flight poll at grant expiry even when fewer than ten seconds remain', async () => {
    post.mockResolvedValueOnce({ ...grant(), expires_in: 6 });
    const auth = await initiateDeviceFlow(signal());
    post.mockImplementationOnce(
      (_endpoint, _form, requestSignal) =>
        new Promise((_resolve, reject) => {
          requestSignal.addEventListener('abort', () => reject(new GitHubOAuthError('cancelled')));
        })
    );
    const result = expect(waitForDeviceTokens(auth, signal())).rejects.toMatchObject({
      code: 'expired_token',
    });
    await vi.advanceTimersByTimeAsync(6000);
    await result;
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('does not make a fourth refresh attempt after repeated transient failure', async () => {
    post.mockRejectedValue(new GitHubOAuthError('network_error', { retryable: true }));
    const result = expect(refreshDeviceToken('private-refresh', signal())).rejects.toMatchObject({
      code: 'network_error',
    });
    await vi.advanceTimersByTimeAsync(3000);
    await result;
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('honors a longer Retry-After when refreshing', async () => {
    post.mockRejectedValueOnce(
      new GitHubOAuthError('http_error', { retryable: true, retryAfterMs: 17000 })
    );
    post.mockResolvedValueOnce(tokens());
    const result = refreshDeviceToken('private-refresh', signal());
    await vi.advanceTimersByTimeAsync(16999);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ accessToken: 'private-access' });
  });

  it('does not retry invalid refresh credentials or accept incomplete token responses', async () => {
    post.mockRejectedValueOnce(new GitHubOAuthError('bad_refresh_token'));
    await expect(refreshDeviceToken('private-refresh', signal())).rejects.toMatchObject({
      code: 'bad_refresh_token',
    });
    expect(post).toHaveBeenCalledTimes(1);
    post.mockResolvedValueOnce({ access_token: 'private-access' });
    await expect(refreshDeviceToken('private-refresh', signal())).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});
