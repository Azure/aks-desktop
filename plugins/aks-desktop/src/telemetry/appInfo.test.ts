// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppInfo } from './appInfo';

// JSDOM exposes navigator.userAgent via a prototype getter — save and
// restore so each test is isolated.
const navigatorProto = Object.getPrototypeOf(window.navigator);
const originalUaDescriptor = Object.getOwnPropertyDescriptor(navigatorProto, 'userAgent');

function stubUserAgent(ua: string): void {
  Object.defineProperty(navigatorProto, 'userAgent', {
    configurable: true,
    get: () => ua,
  });
}

beforeEach(() => {
  delete (window as any).desktopApi;
});

afterEach(() => {
  delete (window as any).desktopApi;
  if (originalUaDescriptor) {
    Object.defineProperty(navigatorProto, 'userAgent', originalUaDescriptor);
  }
  vi.restoreAllMocks();
});

describe('getAppInfo > os', () => {
  it('returns desktopApi.platform when the bridge is present', () => {
    (window as any).desktopApi = { platform: 'darwin' };
    stubUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/31.2.0');
    expect(getAppInfo().os).toBe('darwin');
  });

  it('returns "unknown" when window.desktopApi is absent', () => {
    stubUserAgent('Mozilla/5.0 (X11; Linux x86_64) Electron/31.2.0');
    expect(getAppInfo().os).toBe('unknown');
  });
});

describe('getAppInfo > electronVersion', () => {
  it('parses Electron/<ver> from a typical Electron UA', () => {
    stubUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'aks-desktop/0.40.0 Chrome/126.0.6478.234 Electron/31.2.0 Safari/537.36'
    );
    expect(getAppInfo().electronVersion).toBe('31.2.0');
  });

  it('returns "unknown" when the UA lacks an Electron token', () => {
    stubUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/126.0.6478.234 Safari/537.36'
    );
    expect(getAppInfo().electronVersion).toBe('unknown');
  });
});

describe('getAppInfo > arch', () => {
  it.each([
    ['Mozilla/5.0 (X11; Linux x86_64) Electron/31.2.0', 'x64'],
    ['Mozilla/5.0 (X11; Linux aarch64) Electron/31.2.0', 'arm64'],
    ['Mozilla/5.0 (X11; Linux armv7l) Electron/31.2.0', 'arm'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Electron/31.2.0', 'x64'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/31.2.0', 'x64'],
    ['Mozilla/5.0 (Windows NT 10.0; WOW64) Electron/31.2.0', 'ia32'],
    ['Mozilla/5.0 (Windows NT 10.0; ARM64) Electron/31.2.0', 'arm64'],
  ])('parses %s as "%s"', (ua, expected) => {
    stubUserAgent(ua);
    expect(getAppInfo().arch).toBe(expected);
  });

  it('returns "unknown" for a UA with no recognizable arch token', () => {
    stubUserAgent('Mozilla/5.0 (something unparseable) Electron/31.2.0');
    expect(getAppInfo().arch).toBe('unknown');
  });
});

describe('getAppInfo > full shape', () => {
  it('returns all three fields when sources are present', () => {
    (window as any).desktopApi = { platform: 'linux' };
    stubUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'aks-desktop/0.40.0 Chrome/126.0.6478.234 Electron/31.2.0 Safari/537.36'
    );
    expect(getAppInfo()).toEqual({
      os: 'linux',
      arch: 'x64',
      electronVersion: '31.2.0',
    });
  });

  it('returns all unknowns when no sources are present', () => {
    stubUserAgent('');
    expect(getAppInfo()).toEqual({
      os: 'unknown',
      arch: 'unknown',
      electronVersion: 'unknown',
    });
  });
});
