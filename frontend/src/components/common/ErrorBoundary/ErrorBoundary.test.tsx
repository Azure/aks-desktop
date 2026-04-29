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

import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as analytics from '../../../lib/analytics';
import store from '../../../redux/stores/store';
import ErrorBoundary from './ErrorBoundary';

class CustomDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomDomainError';
  }
}

function Boom({ error }: { error: Error }): JSX.Element {
  throw error;
}

describe('ErrorBoundary telemetry', () => {
  let trackEventSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    trackEventSpy = vi.spyOn(analytics, 'trackEvent').mockImplementation(() => {});
    // React logs caught errors via console.error in dev — silence to keep test output clean.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    trackEventSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('calls trackEvent with exception name and only error.name in properties', () => {
    const err = new CustomDomainError(
      "namespace 'payments' not found at https://example.test/api/v1/namespaces/payments"
    );

    render(
      <Provider store={store}>
        <ErrorBoundary fallback={<div>fallback</div>}>
          <Boom error={err} />
        </ErrorBoundary>
      </Provider>
    );

    expect(trackEventSpy).toHaveBeenCalledWith('exception', { errorName: 'CustomDomainError' });

    // No call shipped the message or stack.
    for (const call of trackEventSpy.mock.calls) {
      const [, properties] = call;
      if (properties) {
        for (const value of Object.values(properties)) {
          expect(value).not.toContain('payments');
          expect(value).not.toContain('https://');
        }
      }
    }
  });

  it('uses the default Error.name "Error" for plain errors', () => {
    render(
      <Provider store={store}>
        <ErrorBoundary fallback={<div>fallback</div>}>
          <Boom error={new Error('boom')} />
        </ErrorBoundary>
      </Provider>
    );

    expect(trackEventSpy).toHaveBeenCalledWith('exception', { errorName: 'Error' });
  });
});
