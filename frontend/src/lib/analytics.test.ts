/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackException } from './analytics';

describe('trackException', () => {
  let trackEventSpy: ReturnType<typeof vi.fn>;
  const originalAppInsights = window.appInsights;

  beforeEach(() => {
    trackEventSpy = vi.fn();
    window.appInsights = { trackEvent: trackEventSpy } as unknown as ApplicationInsights;
  });

  afterEach(() => {
    window.appInsights = originalAppInsights;
  });

  it('forwards only the constructor name — never the message or stack', () => {
    const err = new TypeError('something secret with PII');
    err.stack = 'Error: secret\n    at /home/user/secret/path.ts:1:1';

    trackException(err);

    expect(trackEventSpy).toHaveBeenCalledTimes(1);
    const payload = trackEventSpy.mock.calls[0][0];
    expect(payload).toEqual({
      name: 'exception',
      properties: { errorName: 'TypeError' },
    });
    // Defense in depth: serialize and confirm the secret message and stack
    // are absent from the wire payload.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('path.ts');
  });

  it('falls back to "Error" when error.name is missing', () => {
    trackException({ name: '' } as Error);
    expect(trackEventSpy).toHaveBeenCalledWith({
      name: 'exception',
      properties: { errorName: 'Error' },
    });
  });

  it('is a no-op when appInsights is not initialized', () => {
    window.appInsights = undefined;
    expect(() => trackException(new Error('boom'))).not.toThrow();
    expect(trackEventSpy).not.toHaveBeenCalled();
  });
});
