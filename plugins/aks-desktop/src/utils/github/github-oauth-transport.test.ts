// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { getHeadlampAPIHeaders } from '@kinvolk/headlamp-plugin/lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as telemetry from '../../telemetry';
import { initiateDeviceFlow } from './github-device-flow';
import { GitHubOAuthError, postGitHubOAuth } from './github-oauth-transport';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ getHeadlampAPIHeaders: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();
const signal = () => new AbortController().signal;

describe('GitHub OAuth transport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getHeadlampAPIHeaders).mockReturnValue({
      'X-HEADLAMP_BACKEND-TOKEN': 'local-secret',
    });
    Object.assign(window, { headlampBackendPort: 51234, headlampBaseUrl: '/nested/' });
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Electron');
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (window as Window & { headlampBackendPort?: number }).headlampBackendPort;
    delete (window as Window & { headlampBaseUrl?: string }).headlampBaseUrl;
  });

  it.each([
    ['device', 'https://github.com/login/device/code'],
    ['token', 'https://github.com/login/oauth/access_token'],
  ] as const)('posts %s through the authenticated local proxy', async (endpoint, target) => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    await expect(
      postGitHubOAuth(endpoint, new URLSearchParams({ client_id: 'public-id' }), signal())
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:51234/nested/externalproxy',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        body: 'client_id=public-id',
        headers: {
          'X-HEADLAMP_BACKEND-TOKEN': 'local-secret',
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Forward-To': target,
          'X-Headlamp-Proxy-Redirect': 'error',
        },
      })
    );
  });

  it.each([429, 503])('prioritizes HTTP %i backoff over an OAuth pending body', async status => {
    fetchMock.mockResolvedValue(new Response('{"error":"authorization_pending"}', { status }));
    await expect(postGitHubOAuth('token', new URLSearchParams(), signal())).rejects.toMatchObject({
      code: 'http_error',
      status,
      retryable: true,
    });
  });

  it('rejects an unknown endpoint before any network request', async () => {
    await expect(
      postGitHubOAuth('other' as 'device', new URLSearchParams(), signal())
    ).rejects.toMatchObject({ code: 'invalid_request', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([429, 500, 503])(
    'preserves retry timing for HTTP %i without exposing its body',
    async status => {
      fetchMock.mockResolvedValue(
        new Response('private-server-body', { status, headers: { 'Retry-After': '17' } })
      );
      await expect(postGitHubOAuth('token', new URLSearchParams(), signal())).rejects.toMatchObject(
        { code: 'http_error', status, retryable: true, retryAfterMs: 17000 }
      );
    }
  );

  it('returns only fixed errors for malformed JSON, raw failures and unknown OAuth errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const value of [
      new Response('sentinel-private-data'),
      new Response('{"error":"sentinel-private-data","error_description":"sentinel-private-data"}'),
    ]) {
      fetchMock.mockResolvedValueOnce(value);
      const error = await postGitHubOAuth('token', new URLSearchParams(), signal()).catch(e => e);
      expect(error).toBeInstanceOf(GitHubOAuthError);
      expect(String(error) + JSON.stringify(error)).not.toContain('sentinel-private-data');
    }
    fetchMock.mockRejectedValueOnce(new Error('sentinel-private-data'));
    await expect(postGitHubOAuth('device', new URLSearchParams(), signal())).rejects.toMatchObject({
      code: 'network_error',
      retryable: true,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('keeps credentials and device/user codes out of real enabled telemetry and console sinks', async () => {
    const secrets = [
      'sentinel-access-913',
      'sentinel-refresh-913',
      'sentinel-device-913',
      'sentinel-user-913',
      'local-secret',
    ];
    const batches: string[] = [];
    const logs = (['error', 'warn', 'log', 'info', 'debug'] as const).map(method =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );
    const errors = vi.spyOn(telemetry, 'trackError');
    const features = vi.spyOn(telemetry, 'trackFeature');
    telemetry.__resetForTests();
    telemetry.setTelemetryEnabled(true);
    telemetry.__setTransportOverrideForTests({
      sendPOST(payload, oncomplete) {
        batches.push(
          typeof payload.data === 'string' ? payload.data : new TextDecoder().decode(payload.data)
        );
        oncomplete(200, {}, '');
      },
    });
    try {
      telemetry.initTelemetry({
        connectionString:
          'InstrumentationKey=11111111-1111-4111-8111-111111111111;IngestionEndpoint=https://synthetic.invalid/',
        installId: '11111111-1111-4111-8111-111111111111',
        sessionProps: {
          appVersion: 'test',
          headlampVersion: 'test',
          locale: 'en-US',
          os: 'linux',
          arch: 'x64',
          electronVersion: 'test',
        },
      });
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'invalid_client', error_description: secrets.join(' ') })
        )
      );
      const error = await postGitHubOAuth(
        'token',
        new URLSearchParams({
          refresh_token: secrets[1],
          device_code: secrets[2],
        }),
        signal()
      ).catch(value => value);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: secrets[2],
            user_code: secrets[3],
            verification_uri: 'https://github.com/login/device',
            expires_in: 900,
            interval: 5,
          })
        )
      );
      await initiateDeviceFlow(signal());
      await telemetry.__flushForTests();
      expect(batches.length).toBeGreaterThan(0);
      const observed = JSON.stringify({
        batches,
        logs: logs.map(log => log.mock.calls),
        errors: errors.mock.calls,
        features: features.mock.calls,
        error: String(error) + JSON.stringify(error),
      });
      for (const secret of secrets) expect(observed).not.toContain(secret);
      const envelopes = batches.flatMap(batch => JSON.parse(batch));
      expect(envelopes.some(item => item.data?.baseType === 'RemoteDependencyData')).toBe(false);
      expect(errors).not.toHaveBeenCalled();
      expect(features).not.toHaveBeenCalled();
    } finally {
      telemetry.setTelemetryEnabled(false);
      telemetry.__resetForTests();
    }
  });

  it('reports a clear fixed app-owner prerequisite', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":"device_flow_disabled","error_description":"private"}')
    );
    await expect(postGitHubOAuth('device', new URLSearchParams(), signal())).rejects.toMatchObject({
      code: 'device_flow_disabled',
      retryable: false,
      message: expect.stringContaining('app owner'),
    });
  });

  it('bounds a request at ten seconds and discards a late cancelled result', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('private-abort-reason'))
          );
        })
    );
    const pending = expect(
      postGitHubOAuth('device', new URLSearchParams(), signal())
    ).rejects.toMatchObject({ code: 'request_timeout', retryable: true });
    await vi.advanceTimersByTimeAsync(10000);
    await pending;
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const controller = new AbortController();
    const cancelled = expect(
      postGitHubOAuth('device', new URLSearchParams(), controller.signal)
    ).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort('private-abort-reason');
    resolve(new Response('{"access_token":"late-private-token"}'));
    await cancelled;
  });
});
