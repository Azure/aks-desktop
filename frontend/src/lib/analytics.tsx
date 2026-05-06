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

declare global {
  interface Window {
    appInsights: ApplicationInsights | undefined;
  }
}

/**
 * Track a single event. Only works if app insights is initialized
 *
 * @param name - unique name for the event
 * @param properties - any custom properties
 * @returns
 */
export const trackEvent = (name: string, properties?: Record<string, string>) => {
  const appInsights = window.appInsights;
  if (!appInsights) return;
  try {
    appInsights.trackEvent({ name, properties });
  } catch (e) {
    console.error('Failed to track event', e);
  }
};

/**
 * Track an exception. Forwards only the constructor name (e.g. `TypeError`,
 * `KubeApiError`) — never the message, stack, or `Error` object itself.
 *
 * @deprecated Prefer `trackEvent('exception', { errorName: error.name })`.
 * Retained as a backwards-compatible wrapper for plugins that consume
 * `window.pluginLib.analytics.trackException`.
 *
 * @param error - the error to record
 */
export const trackException = (error: Error) => {
  const appInsights = window.appInsights;
  if (!appInsights) return;
  try {
    appInsights.trackEvent({
      name: 'exception',
      properties: { errorName: error?.name || 'Error' },
    });
  } catch (e) {
    console.error('Failed to track exception', e);
  }
};
