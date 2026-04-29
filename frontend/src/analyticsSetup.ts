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

import { ReactPlugin } from '@microsoft/applicationinsights-react-js';
import { ApplicationInsights, ITelemetryItem } from '@microsoft/applicationinsights-web';

/**
 * Strip identifying tags and URL fields from every outgoing telemetry envelope.
 *
 * This runs on the SDK's send pipeline and is the catch-all that protects us
 * if a future SDK upgrade re-enables auto-collection or if a new call site
 * forgets the "no identifiers" rule. It is intentionally aggressive.
 *
 * Exported for unit testing.
 */
export function privacyTelemetryInitializer(envelope: ITelemetryItem): void {
  envelope.tags = envelope.tags ?? {};
  delete envelope.tags['ai.user.id'];
  delete envelope.tags['ai.user.authUserId'];
  delete envelope.tags['ai.user.accountId'];
  delete envelope.tags['ai.session.id'];
  delete envelope.tags['ai.location.ip'];

  const baseData = envelope.data?.baseData as Record<string, unknown> | undefined;
  if (baseData) {
    if ('uri' in baseData) baseData.uri = '';
    if ('refUri' in baseData) baseData.refUri = '';
    if ('url' in baseData) baseData.url = '';
  }
}

if (import.meta.env.REACT_APP_APPINSIGHTS_CONNECTION_STRING) {
  const reactPlugin = new ReactPlugin();
  window.appInsights = new ApplicationInsights({
    config: {
      connectionString: import.meta.env.REACT_APP_APPINSIGHTS_CONNECTION_STRING,
      extensions: [reactPlugin],

      // Don't auto-collect anything that carries identifiers.
      disableAjaxTracking: true, // K8s API URLs contain ns/resource names
      disableFetchTracking: true, // Azure ARM URLs likewise
      disableExceptionTracking: true, // we route exceptions ourselves, scrubbed
      enableAutoRouteTracking: false, // don't auto-fire pageviews on URL change
      autoTrackPageVisitTime: false,

      // Drop user/session correlation.
      disableCookiesUsage: true,
      isStorageUseDisabled: true,
    },
  });
  window.appInsights.loadAppInsights();
  window.appInsights.addTelemetryInitializer(privacyTelemetryInitializer);
  // trackPageView() intentionally not called — the page URL contains
  // cluster/namespace/resource names. LIST_VIEW / DETAILS_VIEW events from
  // the redux middleware give us per-resource-kind visibility without URLs.
}
