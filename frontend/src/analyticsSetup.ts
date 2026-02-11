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

if (import.meta.env.REACT_APP_APPINSIGHTS_CONNECTION_STRING) {
  const reactPlugin = new ReactPlugin();
  window.appInsights = new ApplicationInsights({
    config: {
      connectionString: import.meta.env.REACT_APP_APPINSIGHTS_CONNECTION_STRING,
      extensions: [reactPlugin],
    },
  });
  window.appInsights.loadAppInsights();
  window.appInsights.trackPageView();
}
