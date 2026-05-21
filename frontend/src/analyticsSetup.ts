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
import { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { privacyTelemetryInitializer } from './lib/analyticsPrivacy';

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
  // Register the privacy scrubber BEFORE loadAppInsights() so any envelope
  // the SDK emits or queues during initialization passes through it.
  window.appInsights.addTelemetryInitializer(privacyTelemetryInitializer);
  window.appInsights.loadAppInsights();
  // trackPageView() intentionally not called — the page URL contains
  // cluster/namespace/resource names. LIST_VIEW / DETAILS_VIEW events from
  // the redux middleware give us per-resource-kind visibility without URLs.
}
